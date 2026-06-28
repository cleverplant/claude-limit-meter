const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

let statusItem;
let kickItem;
let limitItem;
let timer;
let lastSnapshot;
let lastKickState;
let lastRenderedText;
let lastRenderedColor;
let lastTooltipKey;
let lastKickText;
let lastKickColor;
let lastKickVisible;
const fileEventCache = new Map();
const settingsModelCache = new Map();
let limitCache = null; // { data, ts }
const LIMIT_CACHE_TTL = 5 * 60 * 1000;

let extensionContext;

function activate(context) {
  extensionContext = context;

  // Remove leftover installs of older versions of THIS extension that linger
  // in ~/.vscode/extensions when the user installs via the VSIX UI (which
  // doesn't auto-prune previous version folders). VS Code has already picked
  // our version as the active one by the time activate() runs, so deletion
  // of sibling older folders is safe.
  try {
    cleanupOlderInstalls(context);
  } catch (error) {
    // Cleanup is best-effort; never block activation on it.
  }

  // Auto-install kick hook artifacts (script + slash commands + settings.json merge).
  // Idempotent — safe to call on every activate.
  try {
    ensureKickArtifacts(context, { force: false });
  } catch (error) {
    vscode.window.showWarningMessage(`Kick hook install failed: ${error.message}`);
  }

  const priority = vscode.workspace.getConfiguration("claudeLimitMeter").get("statusBarPriority", 999);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
  statusItem.name = "Claude Limit Meter";
  statusItem.command = "claudeLimitMeter.openUsagePage";
  statusItem.show();

  // Higher priority on the right cluster = further LEFT. To place kick item to the
  // RIGHT of cc-ctx, use a lower priority (priority - 1).
  kickItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority - 1);
  kickItem.name = "Kick Auto-Handoff";
  kickItem.command = "claudeLimitMeter.toggleKickHook";
  kickItem.tooltip = "kick";
  if (vscode.workspace.getConfiguration("claudeLimitMeter").get("showKickStatus", true)) {
    kickItem.show();
  }

  limitItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority - 2);
  limitItem.name = "Claude Quota Limit";
  limitItem.command = "claudeLimitMeter.showLimit";
  limitItem.tooltip = "limit";
  limitItem.text = "$(pulse) limit";
  limitItem.color = getTextColor();
  limitItem.show();

  context.subscriptions.push(statusItem);
  context.subscriptions.push(kickItem);
  context.subscriptions.push(limitItem);
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.refresh", refresh));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.toggleBar", toggleBar));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.openUsagePage", openUsagePage));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.toggleKickHook", toggleKickHook));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.showLimit", showLimitPanel));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.reinstallKickHook", () => {
    try { ensureKickArtifacts(context, { force: true });
      vscode.window.showInformationMessage("Kick hook reinstalled.");
    } catch (e) { vscode.window.showErrorMessage(`Reinstall failed: ${e.message}`); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.uninstallKickHook", () => {
    try { uninstallKickArtifacts();
      vscode.window.showInformationMessage("Kick hook uninstalled.");
    } catch (e) { vscode.window.showErrorMessage(`Uninstall failed: ${e.message}`); }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("claudeLimitMeter")) {
      fileEventCache.clear();
      settingsModelCache.clear();
      lastRenderedText = undefined;
      lastRenderedColor = undefined;
      lastTooltipKey = undefined;
      lastKickVisible = undefined;
      restartTimer();
      refresh();
    }
  }));

  restartTimer();
  refresh();
}

function deactivate() {
  if (timer) clearInterval(timer);
  timer = undefined;
  if (kickItem) { kickItem.dispose(); kickItem = undefined; }
  if (limitItem) { limitItem.dispose(); limitItem = undefined; }
}

function restartTimer() {
  if (timer) clearInterval(timer);
  const seconds = vscode.workspace.getConfiguration("claudeLimitMeter").get("updateIntervalSeconds", 10);
  timer = setInterval(refresh, Math.max(2, seconds) * 1000);
}

function refresh() {
  try {
    lastSnapshot = readLatestSnapshot();
    lastKickState = readKickState();
    render(lastSnapshot);
    renderKick(lastKickState);
  } catch (error) {
    lastSnapshot = undefined;
    statusItem.text = "$(warning) cc-ctx ?";
    statusItem.color = getTextColor();
    statusItem.tooltip = `Ошибка Claude Limit Meter: ${error.message}`;
  }
}

function readKickState() {
  const markerPath = path.join(os.homedir(), ".claude", ".kick-disabled");
  return { enabled: !fs.existsSync(markerPath) };
}

function renderKick(state) {
  if (!kickItem) return;
  const showKick = vscode.workspace.getConfiguration("claudeLimitMeter").get("showKickStatus", true);
  if (!showKick) {
    if (lastKickVisible !== false) {
      kickItem.hide();
      lastKickVisible = false;
    }
    return;
  }
  if (lastKickVisible !== true) {
    kickItem.show();
    lastKickVisible = true;
  }

  const text = state.enabled ? "🟢" : "⚪";
  const color = getTextColor();

  if (lastKickText !== text) {
    kickItem.text = text;
    lastKickText = text;
  }
  if (lastKickColor !== color) {
    kickItem.color = color;
    lastKickColor = color;
  }
  // Idempotent show/hide: calling kickItem.show() every tick on an already-shown
  // item triggers a status bar group relayout, which closes the open tooltip on
  // the adjacent cc-ctx item — perceived as blinking every updateIntervalSeconds.
  // No tooltip on this item; the cc-ctx tooltip is the only popup in the group.
}

async function toggleKickHook() {
  const claudeDir = path.join(os.homedir(), ".claude");
  const markerPath = path.join(claudeDir, ".kick-disabled");
  try {
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
      vscode.window.setStatusBarMessage("$(check) Kick auto-hook: ENABLED", 3000);
    } else {
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(markerPath, "");
      vscode.window.setStatusBarMessage("$(circle-slash) Kick auto-hook: DISABLED", 3000);
    }
    refresh();
  } catch (error) {
    vscode.window.showErrorMessage(`Не удалось переключить kick-hook: ${error.message}`);
  }
}

function getClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

// ---------- Quota (server-side rate limit) ----------

function readOAuthToken() {
  const credPath = path.join(os.homedir(), ".claude", ".credentials.json");
  if (!fs.existsSync(credPath)) throw new Error("~/.claude/.credentials.json не найден");
  const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) throw new Error("accessToken не найден в .credentials.json");
  return token;
}

const HEADERS = () => ({
  Authorization: `Bearer ${readOAuthToken()}`,
  "Content-Type": "application/json",
  "User-Agent": "claude-code/2.1.112",
});

let planCache = null; // { name, ts }

async function fetchPlanName() {
  const now = Date.now();
  if (planCache && now - planCache.ts < LIMIT_CACHE_TTL) return planCache.name;
  const res = await fetch("https://api.anthropic.com/api/oauth/profile", { headers: HEADERS() });
  if (!res.ok) return "Pro";
  const d = await res.json();
  const acc = d.account || {};
  const name = acc.has_claude_max ? "Max" : acc.has_claude_pro ? "Pro" : "Free";
  planCache = { name, ts: now };
  return name;
}

async function fetchQuotaData() {
  const now = Date.now();
  if (limitCache && now - limitCache.ts < LIMIT_CACHE_TTL) return limitCache.data;

  const token = readOAuthToken();

  const res = await fetch("https://api.anthropic.com/api/oauth/usage", { headers: HEADERS() });
  if (!res.ok) throw new Error(`API вернул ${res.status}`);

  const data = await res.json();
  limitCache = { data, ts: now };
  return data;
}

// ---------- Context (/context via CLI) ----------

function parseContextOutput(text) {
  const result = { model: "", used: "", total: "", pct: 0, categories: [] };
  const modelM = text.match(/\*\*Model:\*\*\s*(.+)/);
  if (modelM) result.model = modelM[1].trim();
  const tokM = text.match(/\*\*Tokens:\*\*\s*([\d.]+k?)\s*\/\s*([\d.]+k?)\s*\((\d+)%\)/);
  if (tokM) { result.used = tokM[1]; result.total = tokM[2]; result.pct = parseInt(tokM[3]); }
  const rowRe = /\|\s*([^|\-][^|]*?)\s*\|\s*([\d.,]+k?)\s*\|\s*([\d.]+%)\s*\|/g;
  let m;
  while ((m = rowRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (name.toLowerCase() === "category") continue;
    result.categories.push({ name, tokens: m[2], pct: m[3] });
  }
  return result;
}

async function fetchContextData(cwd) {
  const wrapExe = "C:\\Tools\\claude-wrap.exe";
  return new Promise((resolve, reject) => {
    const proc = spawn(wrapExe, [], { cwd, timeout: 20000 });
    let stdout = "", stderr = "";
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });
    proc.on("error", reject);
    proc.on("close", code => {
      if (!stdout && code !== 0) return reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
      resolve(parseContextOutput(stdout));
    });
    proc.stdin.write("/context\n");
    proc.stdin.end();
  });
}

function fmtResetTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtRemaining(isoStr) {
  if (!isoStr) return "—";
  const ms = new Date(isoStr) - Date.now();
  if (ms <= 0) return "сброс";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh > 0 ? `${d} дн ${hh} ч` : `${d} дн`;
  }
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function barHtml(pct, height = 14) {
  const color = pct >= 90 ? "#e05252" : pct >= 65 ? "#e0a030" : "#4caf82";
  return `<div style="background:#2a2a2a;border-radius:4px;height:${height}px;width:100%;margin:4px 0 8px">
    <div style="background:${color};width:${Math.min(pct,100)}%;height:100%;border-radius:4px;transition:width .4s"></div>
  </div>`;
}

function buildFullHtml({ quotaData, planName, workspaceFolders, defaultCwd, contextData, contextError, contextLoading }) {
  const fh = quotaData.five_hour || {};
  const sd = quotaData.seven_day || {};
  const fhPct = Math.round(fh.utilization ?? 0);
  const sdPct = Math.round(sd.utilization ?? 0);
  const fhReset = fmtResetTime(fh.resets_at);
  const sdReset = fmtResetTime(sd.resets_at);
  const fhRemaining = fmtRemaining(fh.resets_at);
  const sdRemaining = fmtRemaining(sd.resets_at);
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const planBadge = planName ? `<span style="font-weight:400;font-size:12px;opacity:.75;margin-left:8px">${planName}</span>` : "";

  const folderOptions = workspaceFolders.map(f =>
    `<option value="${f.uri.fsPath}" ${f.uri.fsPath === defaultCwd ? "selected" : ""}>${path.basename(f.uri.fsPath)}</option>`
  ).join("");

  let ctxHtml = "";
  if (contextLoading) {
    ctxHtml = `<div style="opacity:.6;font-size:12px">Загрузка контекста…</div>`;
  } else if (contextError) {
    ctxHtml = `<div style="color:#e05252;font-size:12px">Ошибка: ${contextError}</div>`;
  } else if (contextData) {
    const catColors = {
      "system prompt": "#e07040", "system tools": "#4090e0", "memory files": "#40b870",
      "skills": "#c07030", "messages": "#a060d0", "autocompact buffer": "#e05252", "free space": "#555"
    };
    const catRows = contextData.categories.map(c => {
      const col = catColors[c.name.toLowerCase()] || "#888";
      return `<tr>
        <td style="padding:2px 8px 2px 0;opacity:.85">${c.name}</td>
        <td style="padding:2px 8px 2px 0;text-align:right;font-variant-numeric:tabular-nums">${c.tokens}</td>
        <td style="padding:2px 0;text-align:right;opacity:.65">${c.pct}</td>
        <td style="padding:2px 0 2px 8px;width:80px">
          <div style="background:#2a2a2a;border-radius:2px;height:6px;width:100%">
            <div style="background:${col};width:${c.pct};height:100%;border-radius:2px"></div>
          </div>
        </td>
      </tr>`;
    }).join("");
    ctxHtml = `
      <div style="font-size:11px;opacity:.7;margin-bottom:2px">${contextData.model} &nbsp;·&nbsp; ${contextData.used} / ${contextData.total}</div>
      ${barHtml(contextData.pct, 12)}
      <div style="font-weight:700;font-size:22px;margin-bottom:10px">${contextData.pct}%</div>
      <table style="font-size:11px;border-collapse:collapse;width:100%">${catRows}</table>`;
  }

  return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px;margin:0;min-width:300px">

<div style="font-weight:600;font-size:14px;margin-bottom:14px">Квота Anthropic${planBadge}</div>
<div style="opacity:.7;font-size:11px;margin-bottom:2px">через ${fhRemaining} &nbsp;·&nbsp; сброс в ${fhReset}</div>
${barHtml(fhPct)}
<div style="font-weight:700;font-size:24px;margin-bottom:14px">${fhPct}%</div>
<div style="opacity:.7;font-size:11px;margin-bottom:2px">через ${sdRemaining} &nbsp;·&nbsp; сброс ${sdReset}</div>
${barHtml(sdPct)}
<div style="font-weight:700;font-size:24px;margin-bottom:12px">${sdPct}%</div>
<button id="btn-quota" onclick="refreshQuota()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 14px;font-size:12px;cursor:pointer">↺ Обновить</button>
<div style="opacity:.5;font-size:10px;margin-top:8px;margin-bottom:4px">
  данные актуальны на ${now} &nbsp;·&nbsp; кеш 5 мин &nbsp;
  <a href="#" onclick="toggleHelp();return false;" style="color:var(--vscode-textLink-foreground);text-decoration:none">Справка</a>
</div>
<div id="help" style="display:none;margin-bottom:8px;padding:10px;background:var(--vscode-textBlockQuote-background);border-radius:4px;font-size:11px;line-height:1.5;opacity:.85">
  Квота запрашивается с серверов Anthropic и кешируется на 5 минут. Повторный клик на «limit» возвращает те же данные без нового запроса. Кнопка ↺ Обновить принудительно запрашивает свежие данные.
</div>

<hr style="border:none;border-top:1px solid #444;margin:14px 0">

<div style="font-weight:600;font-size:14px;margin-bottom:10px">Контекст проекта</div>
<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
  <select id="cwd-select" style="flex:1;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:3px;padding:4px 6px;font-size:12px">
    ${folderOptions}
  </select>
  <button id="btn-ctx" onclick="loadContext()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap">/context</button>
</div>
<div id="ctx-result">${ctxHtml}</div>

<script>
  const vscode = acquireVsCodeApi();
  function refreshQuota() {
    document.getElementById('btn-quota').textContent = 'Обновление…';
    document.getElementById('btn-quota').disabled = true;
    vscode.postMessage({ command: 'refresh' });
  }
  function loadContext() {
    const cwd = document.getElementById('cwd-select').value;
    document.getElementById('btn-ctx').textContent = '…';
    document.getElementById('btn-ctx').disabled = true;
    document.getElementById('ctx-result').innerHTML = '<div style="opacity:.6;font-size:12px">Загрузка контекста…</div>';
    vscode.postMessage({ command: 'context', cwd });
  }
  function toggleHelp() {
    const h = document.getElementById('help');
    h.style.display = h.style.display === 'none' ? 'block' : 'none';
  }
  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.command === 'contextResult') {
      const btn = document.getElementById('btn-ctx');
      btn.textContent = '/context'; btn.disabled = false;
      document.getElementById('ctx-result').innerHTML = msg.html;
    }
  });
</script>
</body></html>`;
}

function buildContextResultHtml(contextData) {
  const catColors = {
    "system prompt": "#e07040", "system tools": "#4090e0", "memory files": "#40b870",
    "skills": "#c07030", "messages": "#a060d0", "autocompact buffer": "#e05252", "free space": "#555"
  };
  const catRows = contextData.categories.map(c => {
    const col = catColors[c.name.toLowerCase()] || "#888";
    return `<tr>
      <td style="padding:2px 8px 2px 0;opacity:.85">${c.name}</td>
      <td style="padding:2px 8px 2px 0;text-align:right;font-variant-numeric:tabular-nums">${c.tokens}</td>
      <td style="padding:2px 0;text-align:right;opacity:.65">${c.pct}</td>
      <td style="padding:2px 0 2px 8px;width:80px">
        <div style="background:#2a2a2a;border-radius:2px;height:6px;width:100%">
          <div style="background:${col};width:${c.pct};height:100%;border-radius:2px"></div>
        </div>
      </td>
    </tr>`;
  }).join("");
  return `
    <div style="font-size:11px;opacity:.7;margin-bottom:2px">${contextData.model} &nbsp;·&nbsp; ${contextData.used} / ${contextData.total}</div>
    <div style="background:#2a2a2a;border-radius:4px;height:12px;width:100%;margin:4px 0 8px">
      <div style="background:${contextData.pct >= 90 ? "#e05252" : contextData.pct >= 65 ? "#e0a030" : "#4caf82"};width:${contextData.pct}%;height:100%;border-radius:4px;transition:width .4s"></div>
    </div>
    <div style="font-weight:700;font-size:22px;margin-bottom:10px">${contextData.pct}%</div>
    <table style="font-size:11px;border-collapse:collapse;width:100%">${catRows}</table>`;
}

function buildLimitErrorHtml(message) {
  return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)">
    <div style="color:#e05252;margin-bottom:8px">Ошибка: ${message}</div>
    <button onclick="refresh()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 14px;font-size:12px;cursor:pointer">↺ Повторить</button>
    <script>const vscode=acquireVsCodeApi();function refresh(){vscode.postMessage({command:'refresh'});}</script>
  </body></html>`;
}

async function showLimitPanel() {
  const panel = vscode.window.createWebviewPanel(
    "claudeQuotaLimit", "Claude Quota",
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: false }
  );

  const folders = vscode.workspace.workspaceFolders || [];
  const defaultCwd = folders[0]?.uri.fsPath || os.homedir();

  async function load(forceRefresh) {
    if (forceRefresh) { limitCache = null; planCache = null; }
    panel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)">Загрузка…</body></html>`;
    try {
      const [quotaData, planName] = await Promise.all([fetchQuotaData(), fetchPlanName().catch(() => "")]);
      panel.webview.html = buildFullHtml({ quotaData, planName, workspaceFolders: folders, defaultCwd });
    } catch (err) {
      panel.webview.html = buildLimitErrorHtml(err.message);
    }
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === "refresh") { load(true); return; }
    if (msg.command === "context") {
      try {
        const ctx = await fetchContextData(msg.cwd);
        panel.webview.postMessage({ command: "contextResult", html: buildContextResultHtml(ctx) });
      } catch (err) {
        panel.webview.postMessage({ command: "contextResult", html: `<div style="color:#e05252;font-size:12px">Ошибка: ${err.message}</div>` });
      }
    }
  });

  load(false);
}

function readLatestSnapshot() {
  const projectsDir = path.join(getClaudeHome(), "projects");
  if (!fs.existsSync(projectsDir)) {
    return { kind: "missing", message: `Папка сессий Claude не найдена: ${projectsDir}` };
  }

  const allFiles = listJsonlFiles(projectsDir)
    .map((file) => ({ file, mtimeMs: safeStat(file)?.mtimeMs || 0 }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const recentFiles = allFiles.slice(0, 40);

  let best;
  for (const entry of recentFiles) {
    const event = readLastAssistantUsage(entry.file);
    if (!event) continue;
    const ts = Date.parse(event.timestamp || 0) || entry.mtimeMs;
    if (!best || ts > best.tsMs) {
      best = { ...event, file: entry.file, tsMs: ts };
    }
  }

  if (!best) {
    return { kind: "missing", message: "В свежих логах Claude не найдено событий usage." };
  }

  const usage = best.usage || {};
  const inputTokens = Number(usage.input_tokens || 0);
  const cacheCreation = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const contextTokens = inputTokens + cacheCreation + cacheRead;
  // Match Claude Code's own status-line formula: effective context window is
  // `model_window − maxOutputTokens − 13000` (auto-compact safety margin).
  // Source: anthropic.claude-code webview bundle, vXe() in 2.1.187.
  const settingsModelInfo = readClaudeSettingsModel(best.cwd);
  const windowInfo = resolveContextWindow(best.model, settingsModelInfo);
  const maxOutput = resolveMaxOutput(best.model);
  const rawWindow = windowInfo.window;
  const windowSource = windowInfo.source;
  const settingsModel = windowInfo.settingsModel;
  const windowSize = Math.max(1, rawWindow - maxOutput - 13000);

  const usedPercent = (contextTokens / windowSize) * 100;
  const leftTokens = Math.max(0, windowSize - contextTokens);

  const aggregates = aggregateUsage(allFiles);

  return {
    kind: "ok",
    timestamp: best.timestamp,
    file: best.file,
    model: best.model,
    sessionId: best.sessionId,
    inputTokens,
    cacheCreation,
    cacheRead,
    outputTokens,
    contextTokens,
    windowSize,
    rawWindow,
    windowSource,
    settingsModel,
    maxOutput,
    usedPercent,
    leftTokens,
    aggregates
  };
}

function listJsonlFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  }
  return result;
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return undefined;
  }
}

function readLastAssistantUsage(file) {
  const stat = safeStat(file);
  if (!stat || stat.size <= 0) return undefined;

  const maxBytes = 768 * 1024;
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line || !line.includes('"usage"') || !line.includes('"assistant"')) continue;
      try {
        const event = JSON.parse(line);
        if (event.type !== "assistant") continue;
        const msg = event.message || {};
        if (!msg.usage) continue;
        return {
          timestamp: event.timestamp,
          model: msg.model,
          sessionId: event.sessionId,
          cwd: event.cwd,
          usage: msg.usage
        };
      } catch {
        // Ignore partial lines from tail reads.
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  return undefined;
}

function aggregateUsage(allFiles) {
  const config = vscode.workspace.getConfiguration("claudeLimitMeter");
  const show5h = config.get("show5hUsage", true);
  const showWeekly = config.get("showWeeklyUsage", true);
  if (!show5h && !showWeekly) {
    return { messages5h: 0, input5h: 0, output5h: 0, cache5h: 0,
             messagesWeek: 0, inputWeek: 0, outputWeek: 0, cacheWeek: 0,
             block5hStartMs: 0, weekStartMs: 0 };
  }

  const scanHours = config.get("scanWindowHours", 192);
  const now = Date.now();
  const earliestMs = now - scanHours * 3600 * 1000;
  const block5hStartMs = now - 5 * 3600 * 1000;
  const weekStartMs = computeWeekStartMs(now);

  let messages5h = 0;
  let input5h = 0;
  let output5h = 0;
  let cache5h = 0;
  let messagesWeek = 0;
  let inputWeek = 0;
  let outputWeek = 0;
  let cacheWeek = 0;

  const seenMessageIds = new Set();

  for (const entry of allFiles) {
    if (entry.mtimeMs < earliestMs) continue;
    const events = readAllAssistantUsages(entry.file, earliestMs);
    for (const ev of events) {
      const tsMs = Date.parse(ev.timestamp || 0);
      if (!tsMs || tsMs < earliestMs) continue;
      if (ev.messageId && seenMessageIds.has(ev.messageId)) continue;
      if (ev.messageId) seenMessageIds.add(ev.messageId);

      const u = ev.usage || {};
      const inp = Number(u.input_tokens || 0);
      const out = Number(u.output_tokens || 0);
      const cache = Number(u.cache_creation_input_tokens || 0) + Number(u.cache_read_input_tokens || 0);

      if (showWeekly && tsMs >= weekStartMs) {
        messagesWeek += 1;
        inputWeek += inp;
        outputWeek += out;
        cacheWeek += cache;
      }
      if (show5h && tsMs >= block5hStartMs) {
        messages5h += 1;
        input5h += inp;
        output5h += out;
        cache5h += cache;
      }
    }
  }

  return {
    messages5h, input5h, output5h, cache5h,
    messagesWeek, inputWeek, outputWeek, cacheWeek,
    block5hStartMs, weekStartMs
  };
}

function readAllAssistantUsages(file, earliestMs) {
  const stat = safeStat(file);
  if (!stat || stat.size <= 0) return [];
  if (stat.mtimeMs < earliestMs) return [];

  const cached = fileEventCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.events;
  }

  const events = [];
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    return events;
  }
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes('"usage"') || !line.includes('"assistant"')) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== "assistant") continue;
      const msg = event.message || {};
      if (!msg.usage) continue;
      events.push({
        timestamp: event.timestamp,
        messageId: msg.id,
        model: msg.model,
        usage: msg.usage
      });
    } catch {
      // Skip malformed lines.
    }
  }

  fileEventCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, events });
  if (fileEventCache.size > 256) {
    const firstKey = fileEventCache.keys().next().value;
    fileEventCache.delete(firstKey);
  }
  return events;
}

function computeWeekStartMs(nowMs) {
  const d = new Date(nowMs);
  const day = d.getDay();
  const daysSinceMonday = (day + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

function resolveContextWindow(model, settingsModelInfo) {
  // Returns { window, source, settingsModel? }. Sources, in priority order:
  //   "override"         — manual claudeLimitMeter.contextWindowOverride.
  //   "jsonl-suffix"     — model name in JSONL already contains [1m]. Rare;
  //                        Claude Code currently strips it before writing.
  //   "project-settings" — <chatCwd>/.claude/settings.json#model contains [1m].
  //   "global-settings"  — ~/.claude/settings.json#model contains [1m].
  //   "known-1m"         — claude-sonnet-4-x / opus-4-x / haiku-4-x (all 1M).
  //   "default"          — fallback 200K for older claude-* models.
  // Auto-overflow promotion is applied later in readLatestSnapshot, not here.
  const override = vscode.workspace.getConfiguration("claudeLimitMeter").get("contextWindowOverride", 0);
  if (override && override > 0) return { window: override, source: "override" };

  const rawLower = (typeof model === "string" ? model : "").toLowerCase();
  if (rawLower.includes("[1m]")) return { window: 1000000, source: "jsonl-suffix" };

  if (settingsModelInfo && typeof settingsModelInfo.model === "string") {
    const settingsLower = settingsModelInfo.model.toLowerCase();
    if (settingsLower.includes("[1m]")) {
      return {
        window: 1000000,
        source: settingsModelInfo.source === "project" ? "project-settings" : "global-settings",
        settingsModel: settingsModelInfo.model
      };
    }
  }

  // Known 1M-window models (claude-sonnet-4-x and newer claude-4 family).
  // claude-opus-4-x and claude-haiku-4-x also have 1M context windows.
  if (rawLower.includes("claude-sonnet-4") ||
      rawLower.includes("claude-opus-4") ||
      rawLower.includes("claude-haiku-4")) {
    return { window: 1000000, source: "known-1m" };
  }

  return { window: 200000, source: "default" };
}

function readClaudeSettingsModel(chatCwd) {
  // Pick up the user's "model" setting from Claude Code's settings.json. Project
  // override takes precedence over global. Cached per-file by mtime+size so this
  // is cheap on every refresh tick.
  const candidates = [];
  if (chatCwd && typeof chatCwd === "string") {
    candidates.push({ path: path.join(chatCwd, ".claude", "settings.json"), source: "project" });
  }
  candidates.push({ path: path.join(getClaudeHome(), "settings.json"), source: "global" });

  for (const c of candidates) {
    const model = readSettingsModelFile(c.path);
    if (model) return { model, source: c.source, path: c.path };
  }
  return undefined;
}

function readSettingsModelFile(filePath) {
  const stat = safeStat(filePath);
  if (!stat) {
    settingsModelCache.delete(filePath);
    return undefined;
  }
  const cached = settingsModelCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.model;
  }
  let model;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (parsed && typeof parsed.model === "string") model = parsed.model;
  } catch {
    // Unparseable settings.json — treat as no signal.
  }
  settingsModelCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, model });
  if (settingsModelCache.size > 32) {
    const firstKey = settingsModelCache.keys().next().value;
    settingsModelCache.delete(firstKey);
  }
  return model;
}

function resolveMaxOutput(model) {
  // Per-model max output tokens. Claude Code reserves this slice plus a
  // fixed 13K safety margin before computing the "context used" percent.
  // 64K matches Claude 4.6/4.7 (Opus and Sonnet); older 4.0/4.1 Opus and
  // 3.x models cap at 8K. Haiku 4.5 is 64K per Anthropic docs.
  if (!model || typeof model !== "string") return 64000;
  const m = model.toLowerCase();
  // Older Opus 4.0 / 4.1 weights still cap at 8K output.
  if (m.startsWith("claude-opus-4-0") || m.startsWith("claude-opus-4-1") ||
      m.includes("opus-4-20250514") || m.includes("opus-4-1-20250805")) return 8192;
  // Claude 3.x family (legacy fallback).
  if (m.startsWith("claude-3-")) return 8192;
  // Default to 64K for 4.5+ family (opus-4-5/4-6/4-7, sonnet-4-5/4-6/4-7, haiku-4-5).
  return 64000;
}

function render(snapshot) {
  if (!snapshot || snapshot.kind !== "ok") {
    const fallback = snapshot?.message || "У Claude Limit Meter ещё нет данных.";
    applyStatus("$(circle-slash) cc-ctx ?", getTextColor(), `fallback:${fallback}`, () => fallback);
    return;
  }

  const state = getState(snapshot.usedPercent);
  const percent = Math.round(snapshot.usedPercent);
  const showBar = vscode.workspace.getConfiguration("claudeLimitMeter").get("showBar", true);
  const bar = showBar ? ` ${makeBar(snapshot.usedPercent)}` : "";
  const text = `${state.dot} cc-ctx${bar} ${percent}%`;
  const tooltipText = buildTooltipText(snapshot, state);
  applyStatus(text, getTextColor(), tooltipText, () => makeTooltip(snapshot, state));
}

function applyStatus(text, color, tooltipKey, tooltipFactory) {
  if (lastRenderedText !== text) {
    statusItem.text = text;
    lastRenderedText = text;
  }
  if (lastRenderedColor !== color) {
    statusItem.color = color;
    lastRenderedColor = color;
  }
  // Only reassign tooltip when its content actually changed. Reassigning .tooltip
  // every tick triggers VS Code to close+reopen the open popup, which the user
  // sees as blinking every updateIntervalSeconds. The key is a stable string
  // representation of the tooltip content; the MarkdownString is built lazily
  // only when we actually need to update.
  if (lastTooltipKey !== tooltipKey) {
    statusItem.tooltip = tooltipFactory();
    lastTooltipKey = tooltipKey;
  }
}

function getTextColor() {
  return vscode.workspace.getConfiguration("claudeLimitMeter").get("textColor", "#1b003f");
}

function getState(percent) {
  const config = vscode.workspace.getConfiguration("claudeLimitMeter");
  const warn = config.get("warnPercent", 65);
  const high = config.get("highPercent", 80);
  const critical = config.get("criticalPercent", 90);

  if (percent >= critical) {
    return { name: "CRITICAL", dot: "🔴", color: "#ff2d2d" };
  }
  if (percent >= high) {
    return { name: "HIGH", dot: "🟠", color: "#ff9f1a" };
  }
  if (percent >= warn) {
    return { name: "WARM", dot: "🟡", color: "#ffe600" };
  }
  return { name: "OK", dot: "🟢", color: "#00ff66" };
}

function makeBar(percent) {
  const length = vscode.workspace.getConfiguration("claudeLimitMeter").get("barLength", 8);
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * length);
  return "▓".repeat(filled) + "░".repeat(Math.max(0, length - filled));
}

function buildTooltipParts(snapshot, state) {
  const kickLabel = lastKickState ? (lastKickState.enabled ? "kick-on" : "kick-off") : "—";

  const rawWin = snapshot.rawWindow || snapshot.windowSize;
  const windowLabel = formatWindowSource(snapshot);
  const dataLines = [
    `Статус:    ${state.name}`,
    `Модель:    ${snapshot.model || "неизвестна"}`,
    `Контекст:  ${formatInt(snapshot.contextTokens)} / ${formatInt(snapshot.windowSize)} (${snapshot.usedPercent.toFixed(1)}%)`,
    `Окно:      ${formatInt(rawWin)} ${windowLabel} − ${formatInt(snapshot.maxOutput || 0)} ответ − 13 000 запас`,
    `Остаток:   ${formatInt(snapshot.leftTokens)} токенов до auto-compact`
  ];

  const config = vscode.workspace.getConfiguration("claudeLimitMeter");
  const agg = snapshot.aggregates || {};
  const has5h = config.get("show5hUsage", true);
  const hasWeek = config.get("showWeeklyUsage", true);
  if (has5h || hasWeek) dataLines.push("");

  if (has5h) {
    const tokens5h = (agg.input5h || 0) + (agg.output5h || 0) + (agg.cache5h || 0);
    dataLines.push(`Окно 5ч:   ${formatInt(agg.messages5h || 0)} сообщ., ${formatInt(tokens5h)} токенов, с ${formatClock(agg.block5hStartMs)}`);
  }

  if (hasWeek) {
    const tokensWeek = (agg.inputWeek || 0) + (agg.outputWeek || 0) + (agg.cacheWeek || 0);
    dataLines.push(`За неделю: ${formatInt(agg.messagesWeek || 0)} сообщ., ${formatInt(tokensWeek)} токенов, с ${formatDate(agg.weekStartMs)}`);
  }

  return { kickLabel, dataLines };
}

function buildTooltipText(snapshot, state) {
  const { kickLabel, dataLines } = buildTooltipParts(snapshot, state);
  const keyLines = dataLines.map((line) => line.replace(/, с .+$/, ""));
  return `kick:${kickLabel}|data:${keyLines.join("\n")}`;
}

function makeTooltip(snapshot, state) {
  return undefined;
}

async function toggleBar() {
  const config = vscode.workspace.getConfiguration("claudeLimitMeter");
  const current = config.get("showBar", true);
  await config.update("showBar", !current, vscode.ConfigurationTarget.Global);
  refresh();
}

async function openUsagePage() {
  const url = vscode.workspace.getConfiguration("claudeLimitMeter").get("usagePageUrl", "https://claude.ai/settings/usage");
  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch (error) {
    vscode.window.showErrorMessage(`Не удалось открыть страницу лимитов: ${error.message}`);
  }
}

function formatClock(ms) {
  if (!ms) return "—";
  const date = new Date(ms);
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDate(ms) {
  if (!ms) return "—";
  const date = new Date(ms);
  return date.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

function formatInt(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatWindowSource(snapshot) {
  switch (snapshot.windowSource) {
    case "override":
      return "(override)";
    case "jsonl-suffix":
      return "модель [1m]";
    case "project-settings":
      return `(.claude/settings.json: ${snapshot.settingsModel})`;
    case "global-settings":
      return `(~/.claude/settings.json: ${snapshot.settingsModel})`;
    case "default":
    default:
      return "модель";
  }
}

// ---------- Self-cleanup of older sibling installs ----------

function cleanupOlderInstalls(context) {
  const ourPath = context.extensionPath;
  const extensionsDir = path.dirname(ourPath);
  const ourFolder = path.basename(ourPath);
  const prefix = "local.claude-limit-meter-";
  if (!ourFolder.startsWith(prefix)) return;
  const ourVersion = ourFolder.substring(prefix.length);

  let entries;
  try {
    entries = fs.readdirSync(extensionsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(prefix)) continue;
    if (entry.name === ourFolder) continue;
    const otherVersion = entry.name.substring(prefix.length);
    if (compareSemver(otherVersion, ourVersion) >= 0) continue;
    const fullPath = path.join(extensionsDir, entry.name);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch {
      // Sibling folder may be locked or already gone — ignore.
    }
  }
}

function compareSemver(a, b) {
  const aParts = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const bParts = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const x = aParts[i] || 0;
    const y = bParts[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// ---------- Kick hook bundled installer ----------

const KICK_FILES = [
  { src: "kick-hook.js", dst: ["scripts", "kick-hook.js"] },
  { src: "kick.md",      dst: ["commands", "kick.md"] },
  { src: "kick-on.md",   dst: ["commands", "kick-on.md"] },
  { src: "kick-off.md",  dst: ["commands", "kick-off.md"] }
];

function getKickPaths() {
  const claudeDir = path.join(os.homedir(), ".claude");
  return {
    claudeDir,
    settingsPath: path.join(claudeDir, "settings.json"),
    markerPath:   path.join(claudeDir, ".kick-installed-version"),
    scriptPath:   path.join(claudeDir, "scripts", "kick-hook.js")
  };
}

function ensureKickArtifacts(context, { force }) {
  const paths = getKickPaths();
  const pkg = require(path.join(context.extensionPath, "package.json"));
  const version = pkg.version;

  if (!force) {
    try {
      const installed = fs.readFileSync(paths.markerPath, "utf8").trim();
      if (installed === version) return; // already at this version, skip silently
    } catch {
      // No marker — fall through to install.
    }
  }

  fs.mkdirSync(path.join(paths.claudeDir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(paths.claudeDir, "commands"), { recursive: true });

  for (const f of KICK_FILES) {
    const srcPath = path.join(context.extensionPath, "resources", f.src);
    const dstPath = path.join(paths.claudeDir, ...f.dst);
    fs.copyFileSync(srcPath, dstPath);
  }

  patchSettingsJsonForKick(paths.settingsPath, paths.scriptPath);
  fs.writeFileSync(paths.markerPath, version);
}

function patchSettingsJsonForKick(settingsPath, scriptPath) {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    // Missing or unparseable — start fresh.
    settings = {};
  }

  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
  if (!Array.isArray(settings.hooks.PostCompact)) settings.hooks.PostCompact = [];

  const desiredCommand = `node ${scriptPath.replace(/\\/g, "/")}`;
  const alreadyHasOurs = settings.hooks.PostCompact.some((entry) =>
    Array.isArray(entry.hooks) && entry.hooks.some((h) =>
      h && h.type === "command" && typeof h.command === "string" && h.command.includes("kick-hook.js")
    )
  );

  if (!alreadyHasOurs) {
    settings.hooks.PostCompact.push({
      hooks: [{ type: "command", command: desiredCommand, timeout: 15 }]
    });
  } else {
    // Update existing entry command to match current installation path (idempotent).
    for (const entry of settings.hooks.PostCompact) {
      if (!Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) {
        if (h && h.type === "command" && typeof h.command === "string" && h.command.includes("kick-hook.js")) {
          h.command = desiredCommand;
          if (!h.timeout) h.timeout = 15;
        }
      }
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function uninstallKickArtifacts() {
  const paths = getKickPaths();

  for (const f of KICK_FILES) {
    const dstPath = path.join(paths.claudeDir, ...f.dst);
    try { fs.unlinkSync(dstPath); } catch {}
  }
  try { fs.unlinkSync(paths.markerPath); } catch {}
  try { fs.unlinkSync(path.join(paths.claudeDir, ".kick-disabled")); } catch {}
  try { fs.unlinkSync(path.join(paths.claudeDir, ".kick-log")); } catch {}

  // Remove our hook entry from settings.json, preserving everything else.
  try {
    const settings = JSON.parse(fs.readFileSync(paths.settingsPath, "utf8"));
    if (settings.hooks && Array.isArray(settings.hooks.PostCompact)) {
      settings.hooks.PostCompact = settings.hooks.PostCompact.filter((entry) => {
        if (!Array.isArray(entry.hooks)) return true;
        return !entry.hooks.some((h) =>
          h && h.type === "command" && typeof h.command === "string" && h.command.includes("kick-hook.js")
        );
      });
      if (settings.hooks.PostCompact.length === 0) delete settings.hooks.PostCompact;
      if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
      fs.writeFileSync(paths.settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch {}
}

module.exports = {
  activate,
  deactivate
};
