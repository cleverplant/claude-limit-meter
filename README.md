# Claude Limit Meter

[Download VSIX v0.3.6](https://github.com/cleverplant/claude-limit-meter/releases/download/v0.3.6/claude-limit-meter-0.3.6.vsix) | [Release notes](https://github.com/cleverplant/claude-limit-meter/releases/tag/v0.3.6)

![Claude Limit Meter status bar and tooltip](claude-limit-meter-0.3.0.png)

Русская версия с расширенными подробностями: [README_ru.md](README_ru.md).

Local VS Code extension that shows current Claude Code context pressure and
rolling 5-hour / weekly token usage in the status bar. Bundles a PostCompact
auto-handoff hook (`/kick auto`) for Claude Code, installed automatically on
extension activation.

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
