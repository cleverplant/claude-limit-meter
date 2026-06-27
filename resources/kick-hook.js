#!/usr/bin/env node
// PostCompact hook — emits a ready-to-paste handoff block via systemMessage.
// Disabled when ~/.claude/.kick-disabled exists (file-marker toggle).
// Logs every fire to ~/.claude/.kick-log (used by status indicators).
//
// Output channel: systemMessage (UI display only — does NOT consume model tokens).

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.USERPROFILE || process.env.HOME;
const MARKER = path.join(HOME, '.claude', '.kick-disabled');
const LOG = path.join(HOME, '.claude', '.kick-log');

// 1. Marker check — silent exit when disabled.
if (fs.existsSync(MARKER)) process.exit(0);

// 2. Read stdin (hook input). Used as fallback for cwd.
let hookInput = {};
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (raw) hookInput = JSON.parse(raw);
} catch (e) {}

const cwd = hookInput.cwd || process.cwd();

// 3. Helpers.
const sh = (cmd) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return ''; }
};

// 4. Git snapshot.
const branch = sh('git rev-parse --abbrev-ref HEAD') || '(no git)';
const statusOut = sh('git status --short');
const lastCommit = sh('git log --oneline -1') || '(no commits)';
const tracked = statusOut.split('\n').filter(l => l && !l.startsWith('??')).length;
const clean = tracked === 0 ? 'clean' : 'dirty';
const upstream = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u}');
const aheadBehind = upstream ? sh(`git rev-list --left-right --count ${upstream}...HEAD`) : '';

// 5. plan.md parse (best-effort, no LLM).
let stage = '(see plans/plan.md)';
let nextStep = '(see plans/plan.md or recent commits)';
const planPath = path.join(cwd, 'plans', 'plan.md');
if (fs.existsSync(planPath)) {
  const plan = fs.readFileSync(planPath, 'utf8');
  const focusMatch = plan.match(/##\s*([^\n]*(?:Current Focus|Текущий фокус)[^\n]*)/i);
  if (focusMatch) stage = focusMatch[1].trim();
  const lines = plan.split('\n');
  const lastDoneIdx = lines.map((l, i) => /^-\s*\[x\]/.test(l) ? i : -1).filter(i => i >= 0).pop();
  if (lastDoneIdx !== undefined) {
    for (let i = lastDoneIdx + 1; i < Math.min(lines.length, lastDoneIdx + 30); i++) {
      const m = lines[i].match(/^-\s*\[\s*\]\s*(.+)$/);
      if (m) { nextStep = m[1].trim(); break; }
    }
  }
}

// 6. Latest isCompactSummary from current session's JSONL.
const encoded = cwd.replace(/[\\/:]/g, '-');
const projDir = path.join(HOME, '.claude', 'projects', encoded);
let summaryText = null;
let summaryAge = null;
if (fs.existsSync(projDir)) {
  const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, m: fs.statSync(path.join(projDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (files.length) {
    const lines = fs.readFileSync(path.join(projDir, files[0].f), 'utf8').split('\n').filter(Boolean);
    let last = null;
    for (const ln of lines) {
      try {
        const o = JSON.parse(ln);
        if (o.isCompactSummary && o.message) {
          const c = o.message.content;
          const text = typeof c === 'string' ? c
            : (Array.isArray(c) ? c.map(p => p.text || '').join('\n') : JSON.stringify(c));
          const ts = o.timestamp ? Date.parse(o.timestamp) : null;
          last = { text, ts };
        }
      } catch (e) {}
    }
    if (last) {
      summaryText = last.text;
      summaryAge = last.ts ? Math.round((Date.now() - last.ts) / 60000) : null;
    }
  }
}

// 7. Build handoff text.
const blockTargeted =
  '```\n' +
  'Read CLAUDE.md, plans/plan.md.\n\n' +
  `We are at: ${stage}.\n\n` +
  `Continue from: ${nextStep}.\n\n` +
  'Constraints:\n' +
  '- Do not widen architecture beyond the task.\n' +
  '- Do not start large refactors without explicit request.\n' +
  '- Destructive git commands (push, reset --hard, rm) require explicit approval per CLAUDE.md §17.2.\n\n' +
  `Current git state: branch ${branch}` +
  (aheadBehind ? ` (${aheadBehind.replace('\t', ' behind / ')} ahead)` : '') +
  `, ${clean}, last commit ${lastCommit}.\n` +
  '```';

let handoff = '🔄 /kick auto (PostCompact) — handoff готов:\n\n' + blockTargeted;

if (summaryText) {
  const ageStr = summaryAge !== null ? `${summaryAge} мин` : 'unknown';
  handoff += '\n\nПолный контекст (post-compact summary, возраст: ' + ageStr + '):\n\n```\n' + summaryText + '\n```';
} else {
  handoff += '\n\n(post-compact summary не найден в JSONL — handoff только targeted-блоком)';
}

// 8. Log fire with rotation — keep at most LOG_MAX_LINES most recent entries.
const LOG_MAX_LINES = 50;
try {
  const newLine = new Date().toISOString() + ' fired cwd=' + cwd + '\n';
  let existing = '';
  try { existing = fs.readFileSync(LOG, 'utf8'); } catch (e) {}
  const all = (existing + newLine).split('\n').filter(Boolean);
  const kept = all.slice(-LOG_MAX_LINES);
  fs.writeFileSync(LOG, kept.join('\n') + '\n');
} catch (e) {}

// 9. Emit as systemMessage (UI only, no model-token cost).
process.stdout.write(JSON.stringify({ systemMessage: handoff }));
