# Claude Limit Meter

[Download VSIX v0.5.0](https://github.com/cleverplant/claude-limit-meter/releases/download/v0.5.0/claude-limit-meter-0.5.0.vsix) · [Release notes](https://github.com/cleverplant/claude-limit-meter/releases/tag/v0.5.0) · [Русская версия](README_ru.md)

![Claude Quota panel](https://raw.githubusercontent.com/cleverplant/claude-limit-meter/main/claude-limit-web.png)

> **Heads-up about data source.** This extension reads everything from the
> **CLI (terminal) Claude Code** — its OAuth credentials in
> `~/.claude/.credentials.json` and, for the `/context` block, a fresh
> CLI sub-session spawned in the chosen workspace folder. It does **not**
> talk to the graphical "Claude Code for VS Code" panel and has no access
> to its in-memory state. As a result, the `/context` block inside the
> Quota web-panel can show a different model or token breakdown than the
> GUI Claude Code panel for the same project — the CLI spawns a fresh
> session to evaluate `/context`, while the GUI shows the live session it
> has open. The 5h / 7-day quota numbers, on the other hand, come from the
> Anthropic account and always match across CLI and GUI.

---

## What's new in 0.5.0

This is a breaking-change release. The extension surface has been cut
down to the one piece that worked reliably across every Claude Code
environment tested. Specifically:

- The `cc-ctx` status bar item (the percent + colored bar) is **gone**.
  Claude Code already shows the same number in its own footer; the
  duplicate added noise and a maintenance burden every time Anthropic
  changed the formula.
- The PostCompact auto-handoff hook is **gone**. The hook's
  `systemMessage` output channel is silently dropped by the VS Code
  Claude Code extension (upstream issue), so the hook fired but its
  output never reached the chat. Keeping it on disk amounted to
  promising a feature that did not work for VS Code users.
- The `🟢 / ⚪` kick-status dot is **gone** along with the hook it
  toggled.
- The slash commands `/kick-on` and `/kick-off` are **gone**. With no
  hook, there is nothing to toggle.
- All settings under `claudeLimitMeter.*` that controlled the above are
  removed: `updateIntervalSeconds`, `barLength`, `showBar`,
  `warnPercent`, `highPercent`, `criticalPercent`,
  `contextWindowOverride`, `show5hUsage`, `showWeeklyUsage`,
  `scanWindowHours`, `showKickStatus`.

What is **kept** and what is **new** for existing users:

- The `limit` status bar item and its Claude Quota web panel are kept
  unchanged.
- The `/kick` slash command is kept. Unlike the PostCompact hook, the
  slash-command path goes through the regular assistant message
  pipeline, so the handoff block always renders in chat with a Copy
  button. The skill body is now in English.
- On first activate, the extension auto-installs `~/.claude/commands/kick.md`
  so `/kick` is immediately available in any Claude Code chat.
- On every activate, the extension cleans up the v0.4.x leftovers in
  `~/.claude/`: `scripts/kick-hook.js`, `commands/kick-on.md`,
  `commands/kick-off.md`, `.kick-installed-version`, `.kick-disabled`,
  `.kick-log`, and any `hooks.PostCompact` entry whose `command`
  contains `kick-hook.js`. Other keys in `settings.json` are left
  untouched.

---

## For users

What this extension adds to VS Code and how to use it day-to-day.

### One status bar item: `limit`

At the bottom right of VS Code a single new item appears:

```
$(pulse) limit
```

Click it to open the Claude Quota web panel.

### The Quota panel (click `limit`)

A panel that opens in the editor area with two blocks:

- **Anthropic quota** — your 5-hour rolling block and 7-day usage as
  percentages, with the time remaining until each window resets and a
  plan badge (`Pro` / `Max` / `Free`). The numbers come from Anthropic
  servers via the same endpoint the official Claude Code app uses. They
  are cached locally for 5 minutes — clicking `limit` again returns the
  cached numbers; the `↺ Refresh` button forces a fresh fetch.
- **Project context (`/context`)** — pick a workspace folder from the
  dropdown and click `/context`. The extension spawns the Claude Code
  CLI in that directory and shows the parsed model name, total context
  used, and a breakdown by category (System prompt, Memory files, Skills,
  Messages, etc.).

> ⚠️ The `/context` block runs a CLI sub-session, not your live VS Code
> Claude Code session. The model and percentages can differ from the
> GUI panel — see the heads-up at the top.

### The `/kick` slash command

`/kick` is a slash command that generates a copy-ready handoff message
for moving from a near-full chat into a fresh one without losing
orientation.

**What it does.** When you type `/kick` in any Claude Code chat, the
skill collects the project's git state, reads `plans/plan.md` if your
project has one, summarizes what happened in the current session, and
prints a fenced markdown block that you can copy with one click. If you
ran `/compact` first, `/kick` also extracts the post-compact summary
from the session JSONL and embeds it as-is in a second fenced block.

**Why it survives where the auto-hook failed.** `/kick` is a regular
slash command. Its output goes through the same chat-message pipeline
as any other assistant reply, so it renders the same way in every
Claude Code surface (CLI, VS Code extension, JetBrains plugin). The
v0.4.x PostCompact auto-hook tried to do the same thing automatically
after compaction, but its `systemMessage` output channel is silently
dropped by the VS Code Claude Code extension. v0.5.0 removes the
auto-hook entirely and ships only the manual command, which works.

**Recommended flow when context is high:** run `/compact` first, then
`/kick`. Compaction writes a structured summary that `/kick` will
embed in its output.

### Install

From the project folder in PowerShell:

```powershell
./install.ps1
```

Then **`Developer: Reload Window`** in VS Code. On first activate, the
`/kick` skill is auto-installed into `~/.claude/commands/kick.md`, and
any leftover v0.4.x kick-hook artifacts are removed.

### Uninstall

Removing the `.vsix` does **not** automatically remove
`~/.claude/commands/kick.md` — VS Code doesn't call `deactivate()` on
uninstall, so the slash command stays available. If that's what you
want (a leaner extension list, `/kick` still works), you can stop here.

For full clean removal:

1. `Extensions → Claude Limit Meter → Uninstall`.
2. Delete `~/.claude/commands/kick.md` (optional — the slash command
   stops working).
3. `Developer: Reload Window`.

**Agent-driven uninstall.** A copy-ready prompt for Codex / Claude Code
is shipped at [prompts/uninstall-full.md](prompts/uninstall-full.md).

---

## Technical details

How it works internally and where its data lives.

### Data sources

Three independent inputs:

| Block | Source | API call? |
|---|---|---|
| 5h / 7d quota | `GET https://api.anthropic.com/api/oauth/usage` using the OAuth access token from `~/.claude/.credentials.json` | Yes (Anthropic) |
| Plan badge (`Pro` / `Max`) | `GET https://api.anthropic.com/api/oauth/profile` (same token) | Yes (Anthropic) |
| `/context` block | Spawns `C:\Tools\claude-wrap.exe` in the picked workspace folder, pipes `/context` to stdin, parses the markdown reply | Indirectly — through the CLI |

The extension never sends chat content anywhere, never reads message
bodies, and never requires you to paste an API key. The OAuth token is
the same token the CLI itself already uses.

### All settings keys

```text
claudeLimitMeter.usagePageUrl       # URL opened by the Open Usage Page command
claudeLimitMeter.statusBarPriority  # position of the limit item (higher = further left)
claudeLimitMeter.textColor          # status bar text color
```

### Command Palette commands

```text
Claude Limit Meter: Open Usage Page (claude.ai)
Claude Limit Meter: Show Quota Limits
```

### Files written into `~/.claude/`

On every activate (idempotent):

```text
~/.claude/commands/kick.md          — the /kick slash command body
```

Nothing else is written. The previous v0.4.x footprint
(`scripts/kick-hook.js`, `commands/kick-on.md`, `commands/kick-off.md`,
`.kick-installed-version`, `.kick-disabled`, `.kick-log`, and the
`hooks.PostCompact` entry inside `settings.json`) is removed
automatically the first time v0.5.0 activates on a machine that had
v0.4.x installed before.

### Why limits are raw quota, not raw token counts

Earlier versions tried to aggregate token usage locally from the JSONL
to estimate the 5-hour and weekly blocks. That number was always wrong
because Claude Code doesn't persist Anthropic plan rate-limit headers
in its session logs, and plan limits vary across Pro / Max 5× / Max 20×
/ API. From v0.4.0 onward the panel calls the same Anthropic endpoint
the official Claude Code app uses — `/api/oauth/usage` — and shows the
real percentages and reset times. The 5-minute cache prevents
hammering the endpoint.
