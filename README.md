# Claude Limit Meter

[Download VSIX v0.4.1](https://github.com/cleverplant/claude-limit-meter/releases/download/v0.4.1/claude-limit-meter-0.4.1.vsix) · [Release notes](https://github.com/cleverplant/claude-limit-meter/releases/tag/v0.4.1) · [Русская версия](README_ru.md)

![Claude Quota panel](https://raw.githubusercontent.com/cleverplant/claude-limit-meter/main/claude-limit-web.png)

![Status bar items](https://raw.githubusercontent.com/cleverplant/claude-limit-meter/main/status-bar.png)

> **Heads-up about data source.** This extension reads everything from the
> **CLI (terminal) Claude Code** — its session logs in `~/.claude/projects/`
> and its OAuth credentials in `~/.claude/.credentials.json`. It does **not**
> talk to the graphical "Claude Code for VS Code" panel and has no access
> to its in-memory state. As a result, the `/context` block inside the Quota
> web-panel can show a different model or token breakdown than the GUI
> Claude Code panel for the same project — the CLI spawns a fresh session
> to evaluate `/context`, while the GUI shows the live session it has open.
> The 5h / 7-day quota numbers, on the other hand, come from the Anthropic
> account and always match across CLI and GUI.

---

## For users

What this extension adds to VS Code and how to use it day-to-day.

### Three status bar items

From left to right at the bottom-right of VS Code:

1. **`cc-ctx ▓▓▓▓▓░░░ 13%`** — the context-fill meter for your most recent
   Claude Code chat. The percent matches what Claude Code itself shows
   inside its own `/context` dialog. The bar colour changes as pressure
   grows:

   ```
   🟢 green   0–64%    OK
   🟡 yellow  65–79%   warm
   🟠 orange  80–89%   high
   🔴 red     90%+     critical, auto-compact imminent
   ```

2. **`🟢` / `⚪` dot** (kick hook indicator) — green when the `/kick auto`
   PostCompact hook is enabled, white when disabled. Click to toggle.

3. **`limit`** — opens the **Claude Quota** web panel (see below). Shows
   your real 5-hour and 7-day usage against your Anthropic plan.

### The Quota panel (click `limit`)

A panel that opens in the editor area with three blocks:

- **Anthropic quota** — your 5-hour rolling block and 7-day usage as
  percentages, with the time remaining until each window resets and a
  plan badge (`Pro` / `Max` / `Free`). The numbers come from Anthropic
  servers via the same endpoint the official Claude Code app uses. They
  are cached locally for 5 minutes — clicking `limit` again returns the
  cached numbers; the `↺ Обновить / Refresh` button forces a fresh fetch.
- **Project context (`/context`)** — pick a workspace folder from the
  dropdown and click `/context`. The extension spawns the Claude Code
  CLI in that directory and shows the parsed model name, total context
  used, and a breakdown by category (System prompt, Memory files, Skills,
  Messages, etc.).
- **Help link** explaining the 5-minute cache.

> ⚠️ The `/context` block runs a CLI sub-session, not your live VS Code
> Claude Code session. The model and percentages can differ from the
> GUI panel — see the heads-up at the top.

### `/kick` PostCompact handoff hook

The extension auto-installs a small hook into Claude Code that helps you
survive auto-compact without losing your bearings.

**The problem it solves.** When a Claude Code chat hits ~91% context, it
auto-compacts: the visible history collapses into a summary, and the real
exchange you were working with is no longer easy to navigate. You can't
just `Ctrl+F` for the message you remember — it isn't on screen any more.

**What the hook does.** Right after every auto-compact (and on demand
via `/kick`), it drops a **ready-to-paste handoff block** into your chat
as a system message. The block includes:

- the current git branch, last commit, working-tree state;
- the active stage from `plans/plan.md` (if the project has one) and the
  next concrete `[ ]` step;
- if Claude Code wrote a structured summary during compaction, that
  summary embedded as-is.

You copy that block, open a new chat, paste, and you're oriented in one
move. The hook output goes through the `systemMessage` channel — **no
model tokens are spent on it.**

**Slash commands available in any Claude Code chat:**

- `/kick` — manual handoff right now (use it before the 91% threshold
  to migrate to a new chat early).
- `/kick-on` — enable PostCompact auto-handoff.
- `/kick-off` — disable PostCompact auto-handoff (the hook stays
  installed but exits silently when it fires).

**Three ways to verify the hook is alive:**

1. **Status bar dot** — green = on, white = off.
2. **After `/compact`** — a system message appears starting with
   `🔄 /kick auto (PostCompact) — handoff готов:`.
3. **The fire log** — open `~/.claude/.kick-log`; every successful fire
   appends one line. Auto-trimmed to the last 50 entries.

A practical recipe when context is high: run `/compact` **first**, then
`/kick`. Compaction writes a structured summary that `/kick` then embeds
into the handoff block.

### Install

From the project folder in PowerShell:

```powershell
./install.ps1
```

Then **`Developer: Reload Window`** in VS Code. The kick hook installs
itself on first activate.

### Uninstall (two valid modes)

Removing the `.vsix` does **not** remove the `/kick` hook — VS Code
doesn't call `deactivate()` on uninstall, so files written into
`~/.claude/` stay on disk until you remove them explicitly. Pick a mode:

**Option A — keep the hook, drop the status bar indicators.**
1. `Extensions → Claude Limit Meter → Uninstall`.
2. `Developer: Reload Window`.

You lose the three status bar items. You keep: `/kick`, `/kick-on`,
`/kick-off` slash commands, the PostCompact auto-handoff, the fire log.

**Option B — full clean removal.**
1. Command Palette → `Claude Limit Meter: Uninstall Kick Hook`.
2. `Extensions → Claude Limit Meter → Uninstall`.
3. `Developer: Reload Window`.

Order matters. If you uninstall the `.vsix` first, the command in step 1
disappears from the palette — see "Manual cleanup" in the technical
section below.

**Agent-driven uninstall.** Copy-ready prompts for Codex / Claude Code
are shipped for both modes — see
[prompts/uninstall-full.md](prompts/uninstall-full.md) and
[prompts/uninstall-vsix-only.md](prompts/uninstall-vsix-only.md).

---

## Technical details

How it works internally and where its data lives.

### Data sources

Three independent inputs:

| Block | Source | API call? |
|---|---|---|
| `cc-ctx %` and hover tooltip | Local JSONL: `~/.claude/projects/<encoded-cwd>/*.jsonl` | No |
| 5h / 7d quota in Quota panel | `GET https://api.anthropic.com/api/oauth/usage` using the OAuth access token from `~/.claude/.credentials.json` | Yes (Anthropic) |
| Plan badge (`Pro` / `Max`) | `GET https://api.anthropic.com/api/oauth/profile` (same token) | Yes (Anthropic) |
| `/context` block | Spawns `C:\Tools\claude-wrap.exe` in the picked workspace folder, pipes `/context` to stdin, parses the markdown reply | Indirectly — through the CLI |

The extension never sends chat content anywhere, never reads message
bodies, and never requires you to paste an API key. The OAuth token is
the same token the CLI itself already uses.

### Context percent formula

For each assistant message in the JSONL:

```text
context_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
effective_window = model_window − max_output_tokens − 13 000   # auto-compact safety margin
percent = context_tokens / effective_window × 100
```

This matches what Claude Code shows inside its own `/context` dialog
(verified against `vXe()` in the Claude Code 2.1.187 webview bundle).
`max_output_tokens` per model: 64K for `claude-opus-4-7`,
`claude-opus-4-6`, `claude-sonnet-4-x`, `claude-haiku-4-5`;
8K for `claude-opus-4-0`, `claude-opus-4-1`, `claude-3-*`.

### Context window detection

Priority order:

1. `claudeLimitMeter.contextWindowOverride` setting (manual override).
2. Model name in the JSONL contains `[1m]` (rare — the CLI strips it).
3. `<chatCwd>/.claude/settings.json#model` contains `[1m]`
   (project-level 1M-beta opt-in).
4. `~/.claude/settings.json#model` contains `[1m]` (global 1M-beta
   opt-in).
5. Fallback: **200 000 tokens** for any `claude-*` family.

### All settings keys

```text
claudeLimitMeter.updateIntervalSeconds      # how often to re-scan the JSONL
claudeLimitMeter.barLength                  # characters in the cc-ctx bar
claudeLimitMeter.showBar                    # show the colored bar
claudeLimitMeter.textColor                  # status bar text color
claudeLimitMeter.warnPercent                # yellow threshold (default 65)
claudeLimitMeter.highPercent                # orange threshold (default 80)
claudeLimitMeter.criticalPercent            # red threshold (default 90)
claudeLimitMeter.contextWindowOverride      # force a specific window size
claudeLimitMeter.show5hUsage                # 5h block in tooltip
claudeLimitMeter.showWeeklyUsage            # weekly block in tooltip
claudeLimitMeter.scanWindowHours            # how far back to scan
claudeLimitMeter.statusBarPriority          # position of cc-ctx
claudeLimitMeter.usagePageUrl               # URL opened on cc-ctx click
claudeLimitMeter.showKickStatus             # show the kick dot
```

### Status bar position

`statusBarPriority` (default `999`) is the cc-ctx priority in the right
cluster. Higher = further LEFT. The kick dot sits at `priority − 1`
and the limit button at `priority − 2`, so the visual order is always
`cc-ctx | kick | limit`.

### Kick hook — files deployed

On first activate the extension writes (idempotent, tracked via
`~/.claude/.kick-installed-version`):

```text
~/.claude/scripts/kick-hook.js          — hook body (systemMessage only, no model tokens)
~/.claude/commands/kick.md              — slash command: manual handoff
~/.claude/commands/kick-on.md           — slash command: enable auto
~/.claude/commands/kick-off.md          — slash command: disable auto
~/.claude/settings.json                 — hooks.PostCompact entry merged in
```

Runtime state files:

```text
~/.claude/.kick-installed-version       — version of currently-deployed hook
~/.claude/.kick-disabled                — toggle marker: present = OFF, absent = ON
~/.claude/.kick-log                     — last 50 fires, auto-rotated
```

### Command Palette commands

```text
Claude Limit Meter: Refresh
Claude Limit Meter: Toggle Bar View
Claude Limit Meter: Open Usage Page (claude.ai)
Claude Limit Meter: Show Quota Limits
Claude Limit Meter: Toggle Kick Auto-Handoff Hook
Claude Limit Meter: Reinstall Kick Hook (force overwrite)
Claude Limit Meter: Uninstall Kick Hook
```

### Manual cleanup (if `.vsix` was already removed)

Delete these files:

```text
~/.claude/scripts/kick-hook.js
~/.claude/commands/kick.md
~/.claude/commands/kick-on.md
~/.claude/commands/kick-off.md
~/.claude/.kick-installed-version
~/.claude/.kick-disabled                (only if present)
~/.claude/.kick-log                     (only if present)
```

Then open `~/.claude/settings.json` and remove the entry inside
`hooks.PostCompact` whose `command` contains `kick-hook.js`. If the
`PostCompact` array becomes empty, delete the `PostCompact` key. If
`hooks` becomes empty, delete the `hooks` key. All other keys
(`permissions`, `model`, `env`, `mcpServers`, …) must be left alone.

### Why limits are raw quota, not raw token counts

Earlier versions tried to aggregate token usage locally from the JSONL
to estimate the 5-hour and weekly blocks. That number was always wrong
because Claude Code doesn't persist Anthropic plan rate-limit headers
in its session logs, and plan limits vary across Pro / Max 5× / Max 20×
/ API. From v0.4.0 onward the panel calls the same Anthropic endpoint
the official Claude Code app uses — `/api/oauth/usage` — and shows the
real percentages and reset times. The 5-minute cache prevents
hammering the endpoint.
