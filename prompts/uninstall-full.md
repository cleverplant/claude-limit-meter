# Uninstall prompt — full removal

Copy-ready prompt for **Codex** or **Claude Code** that fully removes
the Claude Limit Meter VS Code extension and the single artifact it
deploys into `~/.claude/` (`~/.claude/commands/kick.md`).

Equivalent to running, in order:

1. `Extensions → Claude Limit Meter → Uninstall`
2. Delete `~/.claude/commands/kick.md`
3. `Developer: Reload Window`

The agent **cannot trigger step 3** from outside VS Code — you press
the keys yourself after the agent finishes.

Paste the block below into a Codex or Claude Code session.

---

```
Task: fully remove the Claude Limit Meter VS Code extension
(`local.claude-limit-meter`) and the `/kick` slash command file that it
deployed to `~/.claude/commands/kick.md`.

Host: Windows. All paths are rooted at `$env:USERPROFILE`.

What you CANNOT do (you will hand these to the user at the end):
- trigger `Developer: Reload Window` in VS Code (no external API).

Steps (in order, do not skip verification):

1. Pre-flight. If none of these paths exist, the extension is already
   gone — stop and tell the user:
   - `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
   - `$env:USERPROFILE\.claude\commands\kick.md`

2. Delete the slash command file (optional, but the user asked for a
   full removal so do delete it):
   - `$env:USERPROFILE\.claude\commands\kick.md`
   The `commands/` folder itself MUST stay — it can hold other slash
   commands from Claude Code or from other extensions.

3. Belt-and-braces. v0.5.0 already cleans these up on activate, but in
   case the user never installed v0.5.0 and is jumping straight from
   v0.4.x to fully gone, also remove (if present):
   - `$env:USERPROFILE\.claude\scripts\kick-hook.js`
   - `$env:USERPROFILE\.claude\commands\kick-on.md`
   - `$env:USERPROFILE\.claude\commands\kick-off.md`
   - `$env:USERPROFILE\.claude\.kick-installed-version`
   - `$env:USERPROFILE\.claude\.kick-disabled`
   - `$env:USERPROFILE\.claude\.kick-log`
   And patch `$env:USERPROFILE\.claude\settings.json`:
   - read the JSON;
   - in `hooks.PostCompact` remove every entry whose inner `hooks` has
     a `command` containing the substring `kick-hook.js`;
   - if `PostCompact` becomes empty, delete the `PostCompact` key;
   - if `hooks` becomes empty, delete the `hooks` key;
   - all other keys (`permissions`, `model`, `env`, `mcpServers`,
     `apiKeyHelper`, any custom) MUST be left untouched;
   - write atomically (temp file + rename).

4. Delete every installed extension folder:
   - all `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
     → `Remove-Item -Recurse -Force`.

5. Patch `$env:USERPROFILE\.vscode\extensions\extensions.json` (if the
   file exists):
   - read the JSON array;
   - remove every entry with `identifier.id == "local.claude-limit-meter"`
     or with `relativeLocation` starting with `local.claude-limit-meter-`;
   - write atomically.

6. Verification:
   - `Test-Path` on every path from steps 2, 3, and 4 returns `False`;
   - `~/.claude/settings.json` parses as valid JSON and contains no
     substring `kick-hook.js`;
   - `extensions.json` contains no string `local.claude-limit-meter`.
   If any of these fail, do NOT try to recover by restoring a backup
   of `settings.json` — tell the user exactly what failed.

7. Final report:
   - short list of what was deleted;
   - explicit line: "For VS Code to forget the extension completely —
     Ctrl+Shift+P → Developer: Reload Window. You do this yourself."

Forbidden:
- deleting `~/.claude/` or `~/.vscode/extensions/` wholesale;
- editing `settings.json` without an atomic write;
- skipping verification.
```
