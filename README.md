# Claude Limit Meter

[Download VSIX v0.3.8](https://github.com/cleverplant/claude-limit-meter/releases/download/v0.3.8/claude-limit-meter-0.3.8.vsix) | [Release notes](https://github.com/cleverplant/claude-limit-meter/releases/tag/v0.3.8)

![Claude Limit Meter status bar and tooltip](claude-limit-meter-0.3.0.png)

Русская версия с расширенными подробностями: [README_ru.md](README_ru.md).

Local VS Code extension that shows current Claude Code context pressure and
rolling 5-hour / weekly token usage in the status bar. Bundles a PostCompact
auto-handoff hook (`/kick auto`) for Claude Code, installed automatically on
extension activation.

## What's new in 0.3.8

- **Fix: the 0.3.7 overflow safety net is removed.** It promoted a
  200K-mode session to 1M whenever the cumulative
  `cache_read_input_tokens` value from the latest JSONL assistant
  message exceeded the 200K effective window. That number accumulates
  across messages and does not reflect live context size, so the
  heuristic produced a false `1,000,000 (auto-detect по объёму)`
  reading while Claude Code's own panel showed 200K. The meter now
  trusts only `~/.claude/settings.json` / project `.claude/settings.json`
  / the configured override for window detection — exactly the
  channels documented as authoritative for 1M-beta opt-in.

## What's new in 0.3.7

- **Auto-detect of the 1M-context Opus / Sonnet mode.** Earlier versions
  read the model id from the session JSONL (`claude-opus-4-7`,
  `claude-sonnet-4-7`, …). Claude Code does not include the `[1m]`
  suffix in that field even when the 1M beta is active, so the meter
  always defaulted to 200K. It now reads the user's `model` field from
  `~/.claude/settings.json` (and a project-level
  `<chatCwd>/.claude/settings.json` when present) and promotes the
  effective window to 1,000,000 when that string contains `[1m]`
  (e.g. `opus[1m]`, `sonnet[1m]`). Project-level overrides win over
  global. Tooltip now shows where the window came from:
  `Окно: 1 000 000 (~/.claude/settings.json: opus[1m]) − 64 000 ответ
  − 13 000 запас`.
- **Documentation: `/kick` hook explained for users.** Both READMEs now
  carry a user-oriented section near the indicator description
  explaining what the `/kick` PostCompact hook does, the `/kick`,
  `/kick-on`, `/kick-off` slash commands, and three independent ways to
  verify the hook is actually firing (status bar dot, the
  `🔄 /kick auto (PostCompact) — handoff готов:` system message after
  `/compact`, and the `~/.claude/.kick-log` fire log).
- **Documentation: uninstall procedure.** Both READMEs now describe
  two uninstall modes (keep the hook running with Claude Code vs. full
  clean removal), the strict order that matters, why a plain
  `Uninstall` of the extension does not remove the hook (VS Code does
  not call `deactivate()` on uninstall), and a manual-cleanup recipe
  for the case the order was reversed.
- **Agent-driven uninstall prompts.** Two copy-ready prompts shipped at
  [prompts/uninstall-full.md](prompts/uninstall-full.md) and
  [prompts/uninstall-vsix-only.md](prompts/uninstall-vsix-only.md) for
  Codex / Claude Code, with an honest note on what the agent cannot do
  (it cannot trigger `Developer: Reload Window`, and it replicates
  `uninstallKickArtifacts()` via `fs` instead of calling it through the
  Command Palette).

## What's new in 0.3.6

- **Percent now matches Claude Code's own UI.** Earlier versions divided
  the input tokens by the raw model context window (200K). Claude Code
  itself divides by the *effective* window, computed as
  `model_window − maxOutputTokens − 13000` (auto-compact safety margin).
  The extension now uses the same formula, so a session that Claude Code
  shows as `84% context used — click to compact` no longer reads as 52%
  here. Source: `vXe()` inside the Claude Code 2.1.187 webview bundle.
- The tooltip now spells out the math: `Окно: 200 000 модель − 64 000 ответ
  − 13 000 запас`, and "Остаток" is labeled as the distance to auto-compact,
  not to the raw window.

## What's new in 0.3.5

- **No more tooltip flicker on static hover.** Status bar text, color, and
  tooltip content are now cached and only reassigned when underlying values
  actually change. The drifting `HH:MM` / date markers inside the 5h / weekly
  lines are excluded from the change key, so they no longer trigger a tooltip
  rebuild every minute. The kick item's `show()` is also idempotent —
  previously it caused the adjacent `cc-ctx` tooltip to close on every tick.
- **`install.ps1` cleans up after itself.** It removes any older installed
  version of the extension before copying the new one, and now also rewrites
  the `local.claude-limit-meter` entry inside
  `~/.vscode/extensions/extensions.json`. After a version bump VS Code will
  no longer pop the "invalid extension detected" warning.
- **Belt-and-braces auto-cleanup on activate.** On startup the extension
  prunes any sibling `local.claude-limit-meter-*` install folder with a
  version lower than its own.

Default status text:

```text
🟡 cc-ctx ▓▓▓▓▓░░░ 69% 🟢
```

The trailing dot is the kick hook indicator: `🟢` = ON, `⚪` = OFF. Click to
toggle. Hover the cc-ctx item to see hook status as a line in the tooltip
header (`Контекст Claude Code — Хук: kick-on`).

## What the `/kick` hook is for

When Claude Code's context fills up, it auto-compacts. After that, your
visible chat history can effectively become unusable for orientation —
either the prior turns are gone from view, or you have to scroll through a
collapsed summary instead of the real exchange you remember. The full log
is still on disk in JSONL, but reading JSONL by hand to recover "where were
we" is not how a human wants to work.

The `/kick auto` PostCompact hook is the safety net for that case:

- **Right after every auto-compact**, the hook posts a ready-to-paste
  handoff block into the current chat as a system message. The block names
  the git branch, last commit, working-tree state, and — if `plans/plan.md`
  exists — the current stage and next concrete step. You copy the block,
  open a new chat, paste, and you're oriented in one move.
- The hook output is sent through Claude Code's `systemMessage` channel,
  **not** through the model. No model tokens are spent on the handoff text.
- If a post-compact summary is present in the session JSONL (Claude Code
  writes one when it compacts), the hook embeds it AS-IS as a second block
  next to the targeted handoff. You get both a tight prompt and the full
  Claude-written summary to paste.

### Slash commands

- `/kick` — manual handoff. Drops a fresh handoff block into the chat
  immediately, without waiting for compaction. Use this **before** the
  91% auto-compact threshold when you want to migrate to a new chat early.
- `/kick-on` — enable the PostCompact auto-handoff (removes
  `~/.claude/.kick-disabled`).
- `/kick-off` — disable the auto-handoff (creates
  `~/.claude/.kick-disabled`). The hook stays installed in
  `settings.json` but exits silently when fired.

The `🟢 / ⚪` dot to the right of `cc-ctx` mirrors that marker file in real
time. Clicking the dot toggles `kick-on` ↔ `kick-off` without touching
`settings.json`.

### How to verify the hook is actually working

Three independent checks:

1. **Status bar.** The dot is `🟢` when enabled, `⚪` when disabled. The
   first line of the `cc-ctx` tooltip says `Хук: kick-on` or `Хук: kick-off`.
2. **The chat right after `/compact`.** With the hook enabled, you'll see
   a system message starting with `🔄 /kick auto (PostCompact) — handoff
   готов:` followed by the copy-ready block. If you run `/compact` and
   don't see that line, either `/kick-off` is active or the hook didn't
   install — re-run `Claude Limit Meter: Reinstall Kick Hook (force
   overwrite)` from the Command Palette.
3. **The fire log.** Open `~/.claude/.kick-log` — every successful fire
   appends a line like `2026-06-27T14:32:11.842Z fired cwd=C:\path\to\project`.
   The file auto-trims to the last 50 entries (~4 KB), so no rotation
   tooling is needed.

A practical recipe when context is high: run `/compact` first, then
`/kick`. Compaction writes a structured summary into the JSONL, which
`/kick` then embeds as the deep-context block.

Color/state thresholds:

```text
🟢 bright green   0-64%   OK
🟡 bright yellow  65-79%  WARM
🟠 orange         80-89%  HIGH
🔴 red            90%+    CRITICAL
```

The meter reads only local Claude Code session logs from:

```text
%USERPROFILE%\.claude\projects
```

It does not call the Claude API, does not need an API key, and does not read
message content beyond parsing token usage events. The extension shows the last
active Claude Code chat. It updates after Claude replies.

## Hover tooltip

Hover the status item to see:

- model name and current context percentage
- input / cache_read / cache_create / output token breakdown for the last reply
- 5-hour rolling token usage (messages, output, total)
- weekly token usage since Monday (messages, output, total)

## How it works

Each assistant message in a Claude Code session JSONL contains a `usage` object:

```json
{
  "type": "assistant",
  "timestamp": "...",
  "message": {
    "model": "claude-opus-4-7",
    "usage": {
      "input_tokens": 1,
      "cache_creation_input_tokens": 1783,
      "cache_read_input_tokens": 41453,
      "output_tokens": 202
    }
  }
}
```

Context pressure is computed as:

```text
context = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
percent = context / model_context_window * 100
```

Model context window defaults to 200,000 tokens for all current Claude families
and 1,000,000 if the model name contains `[1m]` (Sonnet 4.x extended context).
Override via `claudeLimitMeter.contextWindowOverride` if needed.

## Why limits are shown as raw usage, not percent

Claude Code does not persist rate-limit headers (Anthropic plan limits) in its
local session JSONL files. The extension therefore aggregates token usage
locally over fixed windows:

- 5-hour rolling block (matches Claude Pro/Max rolling block model)
- This week since Monday 00:00 local time

Absolute numbers are shown rather than a "% of plan", because plan limits vary
(Pro, Max 5x, Max 20x, API) and are not stored on disk. Compare the numbers
against your plan to estimate headroom.

## Position

The status bar item is placed at priority **999** by default. Higher priority
means a position further to the **left** in the right-aligned cluster. Change
with `claudeLimitMeter.statusBarPriority`. The kick-hook indicator is rendered
at `priority - 1`, so it sits immediately to the right of `cc-ctx`.

## Settings

```text
claudeLimitMeter.updateIntervalSeconds
claudeLimitMeter.barLength
claudeLimitMeter.showBar
claudeLimitMeter.textColor
claudeLimitMeter.warnPercent
claudeLimitMeter.highPercent
claudeLimitMeter.criticalPercent
claudeLimitMeter.contextWindowOverride
claudeLimitMeter.show5hUsage
claudeLimitMeter.showWeeklyUsage
claudeLimitMeter.scanWindowHours
claudeLimitMeter.statusBarPriority
claudeLimitMeter.showKickStatus
```

## Bundled kick hook (`/kick auto`)

The extension bundles a PostCompact hook for Claude Code that emits a
ready-to-paste handoff block in chat after every context compaction. Files
deployed on first activate (idempotent, version-tracked via
`~/.claude/.kick-installed-version`):

```text
~/.claude/scripts/kick-hook.js       — hook body (no model tokens, systemMessage only)
~/.claude/commands/kick.md           — manual handoff (slash command)
~/.claude/commands/kick-on.md        — enable PostCompact auto-handoff
~/.claude/commands/kick-off.md       — disable PostCompact auto-handoff
~/.claude/settings.json              — hooks.PostCompact entry merged in
```

Toggle marker (instant on/off without settings.json edit):

```text
~/.claude/.kick-disabled             — file present = OFF, absent = ON
~/.claude/.kick-log                  — last 50 fires, rotated automatically
```

Command Palette commands:

- `Claude Limit Meter: Toggle Kick Auto-Handoff Hook` — same as clicking the dot
- `Claude Limit Meter: Reinstall Kick Hook (force overwrite)`
- `Claude Limit Meter: Uninstall Kick Hook` — removes files, settings entry, markers, log

## Install

Run from this directory in PowerShell:

```powershell
./install.ps1
```

Then `Developer: Reload Window` in VS Code. The kick hook installs itself on
first activate.

## Uninstall

You have a choice — and it matters, because **removing the `.vsix` does
not remove the kick hook.** This is a VS Code limitation: VS Code does
not call `deactivate()` when an extension is uninstalled, and the
Extension API gives no uninstall hook. So whatever the extension wrote
into `~/.claude/` on first activate stays on disk until you remove it
explicitly.

Two valid uninstall modes follow.

### Option A — keep the kick hook, drop the status bar indicators

Useful if you want the PostCompact auto-handoff in Claude Code to keep
working but don't need the `cc-ctx` percent meter in the VS Code status
bar any longer.

1. `Extensions → Claude Limit Meter → Uninstall` in VS Code.
2. `Developer: Reload Window`.

What you **lose**:

- the `cc-ctx` context-percent indicator in the status bar;
- the `🟢/⚪` kick dot and the one-click toggle;
- auto-deployment of future hook versions (you'll either re-install the
  extension or update `~/.claude/scripts/kick-hook.js` by hand).

What still **works**, with no extra setup:

- `/kick`, `/kick-on`, `/kick-off` slash commands — Claude Code reads
  them straight from `~/.claude/commands/`, the extension is not needed
  for that;
- PostCompact auto-handoff — Claude Code reads the entry from
  `~/.claude/settings.json` and runs `kick-hook.js` after every
  compaction;
- `~/.claude/.kick-log` keeps appending one line per fire;
- toggle is still instant, just routed through slash commands: `/kick-off`
  creates `~/.claude/.kick-disabled`, `/kick-on` deletes it. No popup, no
  external UI — the hook simply stops/starts firing.

### Option B — full clean removal

Removes the extension **and** every file it ever wrote.

1. Command Palette → `Claude Limit Meter: Uninstall Kick Hook`.
   This removes `~/.claude/scripts/kick-hook.js`,
   `~/.claude/commands/kick.md`, `kick-on.md`, `kick-off.md`,
   `~/.claude/.kick-installed-version`, `.kick-disabled`, `.kick-log`,
   and the `hooks.PostCompact` entry inside `~/.claude/settings.json`.
   All other keys in `settings.json` are preserved.
2. `Extensions → Claude Limit Meter → Uninstall` in VS Code.
3. `Developer: Reload Window`.

Order matters. If you uninstall the extension first,
`Claude Limit Meter: Uninstall Kick Hook` is no longer registered in the
Command Palette, and you'll have to clean up by hand (next section).

### Manual cleanup (if you already removed the extension)

Delete the following:

```text
~/.claude/scripts/kick-hook.js
~/.claude/commands/kick.md
~/.claude/commands/kick-on.md
~/.claude/commands/kick-off.md
~/.claude/.kick-installed-version
~/.claude/.kick-disabled        (only if present)
~/.claude/.kick-log             (only if present)
```

Then open `~/.claude/settings.json` and remove the entry inside
`hooks.PostCompact` whose `command` contains `kick-hook.js`. If the
`PostCompact` array becomes empty, delete the `PostCompact` key. If
`hooks` becomes empty, delete the `hooks` key.

If you change your mind later and re-install the extension, it re-deploys
the hook on first activate. Installation is idempotent and version-tracked
via `~/.claude/.kick-installed-version`, so re-install is safe.

### Agent-driven automation

If you'd rather hand the uninstall to an agent (Codex or Claude Code) —
e.g. on CI, during dev-env teardown, when rolling out across many
machines, or when supporting a user who isn't comfortable with the
Command Palette and the extension registry — the project ships two
copy-ready prompts:

- [prompts/uninstall-full.md](prompts/uninstall-full.md) — full
  removal (Option B above).
- [prompts/uninstall-vsix-only.md](prompts/uninstall-vsix-only.md) —
  VSIX only, leave the hook running (Option A above).

What the agent **cannot** do for you:

- Trigger `Developer: Reload Window` in VS Code — no external API
  exposes that command. You press the keys after the agent finishes.
- Call `Claude Limit Meter: Uninstall Kick Hook` from the Command
  Palette directly — it's bound to the VS Code process. The prompt
  replicates its effect via `fs` + JSON ops instead. Trade-off: if a
  future version of this extension changes
  `uninstallKickArtifacts()` (for example, starts cleaning extra
  files), the prompt will silently drift until it's updated.

For a single personal machine the manual path (Options A and B above)
is usually faster than spinning up an agent. Agent automation pays off
for repeated teardown or remote support.
