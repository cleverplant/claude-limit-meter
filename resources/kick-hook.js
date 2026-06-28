#!/usr/bin/env node
// PostCompact hook — emits a ready-to-paste handoff block via systemMessage.
// Disabled when ~/.claude/.kick-disabled exists (file-marker toggle).
// Logs every fire to ~/.claude/.kick-log (used by status indicators).
//
// Output channel: systemMessage (UI display only — does NOT consume model tokens).
// Output is a single fenced code block: copy it from the chat, paste into a new chat.

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

// 5. Project file presence + plan.md parse (best-effort, no LLM).
const hasClaudeMd = fs.existsSync(path.join(cwd, 'CLAUDE.md'));
const planPath = path.join(cwd, 'plans', 'plan.md');
const hasPlan = fs.existsSync(planPath);

let stage = null;
let nextStep = null;
if (hasPlan) {
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

// 6. Build handoff text.
//    Single fenced code block — the chat UI renders it with a copy button.
//    No project history, no JSONL summary, no per-file gymnastics.
//    The new chat is told: if the user pastes a summary above this prompt, use it; otherwise continue.
const readTargets = [];
if (hasClaudeMd) readTargets.push('CLAUDE.md');
if (hasPlan) readTargets.push('plans/plan.md');
const readLine = readTargets.length
  ? `Read ${readTargets.join(', ')}.`
  : 'No CLAUDE.md or plans/plan.md in this project — derive context from recent commits.';

const stageLine = stage
  ? `We are at: ${stage}.`
  : (hasPlan ? 'We are at: (Current Focus not found in plan.md — derive from recent commits).'
             : 'We are at: (no plan file — derive from recent commits).');

const nextLine = nextStep
  ? `Continue from: ${nextStep}.`
  : 'Continue from: nearest concrete next step inferable from recent commits.';

const destructiveRule = hasClaudeMd
  ? '- Destructive git commands (push, reset --hard, rm) require explicit approval per CLAUDE.md §17.2.'
  : '- Destructive git commands (push, reset --hard, rm) require explicit user approval.';

const block =
  '```\n' +
  readLine + '\n\n' +
  stageLine + '\n\n' +
  nextLine + '\n\n' +
  'If the user pasted a post-compact summary above this prompt, use it for deeper context. ' +
  'If not, continue without it — do not ask for one.\n\n' +
  'Constraints:\n' +
  '- Do not widen architecture beyond the task.\n' +
  '- Do not start large refactors without explicit request.\n' +
  destructiveRule + '\n\n' +
  `Current git state: branch ${branch}` +
  (aheadBehind ? ` (${aheadBehind.replace('\t', ' behind / ')} ahead)` : '') +
  `, ${clean}, last commit ${lastCommit}.\n` +
  '```';

const handoff = '🔄 /kick auto (PostCompact) — скопируй промпт ниже в новый чат:\n\n' + block;

// 7. Log fire with rotation — keep at most LOG_MAX_LINES most recent entries.
const LOG_MAX_LINES = 50;
try {
  const newLine = new Date().toISOString() + ' fired cwd=' + cwd + '\n';
  let existing = '';
  try { existing = fs.readFileSync(LOG, 'utf8'); } catch (e) {}
  const all = (existing + newLine).split('\n').filter(Boolean);
  const kept = all.slice(-LOG_MAX_LINES);
  fs.writeFileSync(LOG, kept.join('\n') + '\n');
} catch (e) {}

// 8. Emit as systemMessage (UI only, no model-token cost).
process.stdout.write(JSON.stringify({ systemMessage: handoff }));
