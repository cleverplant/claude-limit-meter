const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

let limitItem;
let limitCache = null;
let planCache = null;
const LIMIT_CACHE_TTL = 5 * 60 * 1000;

function activate(context) {
  try { cleanupOlderInstalls(context); } catch (_) {}
  try { cleanupLegacyKickArtifacts(); } catch (_) {}
  try { ensureKickSkill(context); } catch (error) {
    vscode.window.showWarningMessage(`Kick skill install failed: ${error.message}`);
  }

  const priority = vscode.workspace.getConfiguration("claudeLimitMeter").get("statusBarPriority", 999);
  limitItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
  limitItem.name = "Claude Quota Limit";
  limitItem.command = "claudeLimitMeter.showLimit";
  limitItem.tooltip = "Show Anthropic 5h / 7d quota and project /context";
  limitItem.text = "$(pulse) limit";
  limitItem.color = getTextColor();
  limitItem.show();

  context.subscriptions.push(limitItem);
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.openUsagePage", openUsagePage));
  context.subscriptions.push(vscode.commands.registerCommand("claudeLimitMeter.showLimit", showLimitPanel));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("claudeLimitMeter.textColor")) {
      limitItem.color = getTextColor();
    }
  }));
}

function deactivate() {
  if (limitItem) { limitItem.dispose(); limitItem = undefined; }
}

function getClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function getTextColor() {
  return vscode.workspace.getConfiguration("claudeLimitMeter").get("textColor", "#1b003f");
}

// ---------- Anthropic quota (server-side rate limit) ----------

function readOAuthToken() {
  const credPath = path.join(getClaudeHome(), ".credentials.json");
  if (!fs.existsSync(credPath)) throw new Error("~/.claude/.credentials.json not found");
  const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const token = creds?.claudeAiOauth?.accessToken;
  if (!token) throw new Error("accessToken missing in .credentials.json");
  return token;
}

const HEADERS = () => ({
  Authorization: `Bearer ${readOAuthToken()}`,
  "Content-Type": "application/json",
  "User-Agent": "claude-code/2.1.112",
});

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
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", { headers: HEADERS() });
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const data = await res.json();
  limitCache = { data, ts: now };
  return data;
}

// ---------- Project /context (via CLI) ----------

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

// ---------- Formatting helpers ----------

function fmtResetTime(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function fmtRemaining(isoStr) {
  if (!isoStr) return "—";
  const ms = new Date(isoStr) - Date.now();
  if (ms <= 0) return "reset";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const hh = h % 24;
    return hh > 0 ? `${d}d ${hh}h` : `${d}d`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function barHtml(pct, height = 14) {
  const color = pct >= 90 ? "#e05252" : pct >= 65 ? "#e0a030" : "#4caf82";
  return `<div style="background:#2a2a2a;border-radius:4px;height:${height}px;width:100%;margin:4px 0 8px">
    <div style="background:${color};width:${Math.min(pct,100)}%;height:100%;border-radius:4px;transition:width .4s"></div>
  </div>`;
}

// ---------- Webview HTML ----------

function buildFullHtml({ quotaData, planName, workspaceFolders, defaultCwd }) {
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

  return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px;margin:0;min-width:300px">

<div style="font-weight:600;font-size:14px;margin-bottom:14px">Anthropic quota${planBadge}</div>
<div style="opacity:.7;font-size:11px;margin-bottom:2px">in ${fhRemaining} &nbsp;·&nbsp; resets at ${fhReset}</div>
${barHtml(fhPct)}
<div style="font-weight:700;font-size:24px;margin-bottom:14px">${fhPct}%</div>
<div style="opacity:.7;font-size:11px;margin-bottom:2px">in ${sdRemaining} &nbsp;·&nbsp; resets ${sdReset}</div>
${barHtml(sdPct)}
<div style="font-weight:700;font-size:24px;margin-bottom:12px">${sdPct}%</div>
<button id="btn-quota" onclick="refreshQuota()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 14px;font-size:12px;cursor:pointer">↺ Refresh</button>
<div style="opacity:.5;font-size:10px;margin-top:8px;margin-bottom:4px">
  data as of ${now} &nbsp;·&nbsp; cached 5 min &nbsp;
  <a href="#" onclick="toggleHelp();return false;" style="color:var(--vscode-textLink-foreground);text-decoration:none">Help</a>
</div>
<div id="help" style="display:none;margin-bottom:8px;padding:10px;background:var(--vscode-textBlockQuote-background);border-radius:4px;font-size:11px;line-height:1.5;opacity:.85">
  The quota is queried from Anthropic's servers and cached locally for 5 minutes. Clicking "limit" again returns the cached numbers without a fresh request. The ↺ Refresh button forces a new request.
</div>

<hr style="border:none;border-top:1px solid #444;margin:14px 0">

<div style="font-weight:600;font-size:14px;margin-bottom:10px">Project context</div>
<div style="display:flex;gap:6px;align-items:center;margin-bottom:10px">
  <select id="cwd-select" style="flex:1;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);border-radius:3px;padding:4px 6px;font-size:12px">
    ${folderOptions}
  </select>
  <button id="btn-ctx" onclick="loadContext()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 12px;font-size:12px;cursor:pointer;white-space:nowrap">/context</button>
</div>
<div id="ctx-result"></div>

<script>
  const vscode = acquireVsCodeApi();
  function refreshQuota() {
    document.getElementById('btn-quota').textContent = 'Refreshing…';
    document.getElementById('btn-quota').disabled = true;
    vscode.postMessage({ command: 'refresh' });
  }
  function loadContext() {
    const cwd = document.getElementById('cwd-select').value;
    document.getElementById('btn-ctx').textContent = '…';
    document.getElementById('btn-ctx').disabled = true;
    document.getElementById('ctx-result').innerHTML = '<div style="opacity:.6;font-size:12px">Loading context…</div>';
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
    <div style="color:#e05252;margin-bottom:8px">Error: ${message}</div>
    <button onclick="refresh()" style="background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:5px 14px;font-size:12px;cursor:pointer">↺ Retry</button>
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
    panel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-editor-foreground);background:var(--vscode-editor-background)">Loading…</body></html>`;
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
        panel.webview.postMessage({ command: "contextResult", html: `<div style="color:#e05252;font-size:12px">Error: ${err.message}</div>` });
      }
    }
  });

  load(false);
}

async function openUsagePage() {
  const url = vscode.workspace.getConfiguration("claudeLimitMeter").get("usagePageUrl", "https://claude.ai/settings/usage");
  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open usage page: ${error.message}`);
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
    } catch {}
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

// ---------- /kick skill install ----------

function ensureKickSkill(context) {
  const claudeDir = getClaudeHome();
  const commandsDir = path.join(claudeDir, "commands");
  const dstPath = path.join(commandsDir, "kick.md");
  const srcPath = path.join(context.extensionPath, "resources", "kick.md");
  if (!fs.existsSync(srcPath)) return;
  fs.mkdirSync(commandsDir, { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
}

// ---------- Legacy v0.4.x cleanup ----------
//
// v0.4.x shipped a PostCompact hook (~/.claude/scripts/kick-hook.js) and two
// auxiliary slash commands (kick-on/kick-off). The hook's systemMessage output
// is silently dropped by the VS Code Claude Code extension, so v0.5.0 removes
// the entire hook surface. Existing users who upgrade get the leftovers swept
// away here, idempotently, on every activate.

function cleanupLegacyKickArtifacts() {
  const claudeDir = getClaudeHome();
  const legacyPaths = [
    path.join(claudeDir, "scripts", "kick-hook.js"),
    path.join(claudeDir, "commands", "kick-on.md"),
    path.join(claudeDir, "commands", "kick-off.md"),
    path.join(claudeDir, ".kick-installed-version"),
    path.join(claudeDir, ".kick-disabled"),
    path.join(claudeDir, ".kick-log"),
  ];
  for (const p of legacyPaths) {
    try { fs.unlinkSync(p); } catch {}
  }

  const settingsPath = path.join(claudeDir, "settings.json");
  let raw;
  try { raw = fs.readFileSync(settingsPath, "utf8"); } catch { return; }
  let settings;
  try { settings = JSON.parse(raw); } catch { return; }
  if (!settings || typeof settings !== "object") return;
  if (!settings.hooks || !Array.isArray(settings.hooks.PostCompact)) return;

  const filtered = settings.hooks.PostCompact.filter((entry) => {
    if (!entry || !Array.isArray(entry.hooks)) return true;
    return !entry.hooks.some((h) =>
      h && h.type === "command" && typeof h.command === "string" && h.command.includes("kick-hook.js")
    );
  });
  if (filtered.length === settings.hooks.PostCompact.length) return; // nothing to remove

  if (filtered.length === 0) {
    delete settings.hooks.PostCompact;
  } else {
    settings.hooks.PostCompact = filtered;
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2)); } catch {}
}

module.exports = { activate, deactivate };
