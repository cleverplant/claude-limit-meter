# Uninstall prompt — full removal (with VS Code storage tails)

Copy-ready prompt for **Codex** or **Claude Code** that fully removes
the Claude Limit Meter VS Code extension, every artifact it deploys
into `~/.claude/`, and every leftover VS Code created for it
(`globalStorage`, `workspaceStorage`, the `extensions/.obsolete`
manifest, the `extensions.json` registry entry).

Equivalent to running, in order:

1. `Extensions → Claude Limit Meter → Uninstall`
2. Delete `~/.claude/commands/kick.md`
3. Manually delete every VS Code per-extension storage folder
4. **Quit VS Code completely** (not `Developer: Reload Window` — a
   reload reuses the same extension host process; only a full quit
   drops cached webview state and JIT-compiled extension code).

The agent **cannot trigger step 4** from outside VS Code — you close
all VS Code windows yourself after the agent finishes.

Paste the block below into a Codex or Claude Code session.

---

```
Task: fully remove the Claude Limit Meter VS Code extension
(`local.claude-limit-meter`), every artifact it deployed under
`~/.claude/`, and every leftover VS Code created for the extension
under `$env:APPDATA\Code\` and `~/.vscode/extensions/`.

The goal is a state where a fresh `.vsix` install test from scratch
is meaningful — no cached state, no orphan storage folders, no
ghost registry entries.

Host: Windows. All paths are rooted at `$env:USERPROFILE` and
`$env:APPDATA` (which on Windows resolves to
`$env:USERPROFILE\AppData\Roaming`).

What you CANNOT do (you will hand this to the user at the end):
- close all VS Code windows (no external API).

Steps (in order, do not skip verification):

1. Pre-flight. If none of the following paths exist AND the
   `extensions.json` registry has no `local.claude-limit-meter` entry
   AND no `.obsolete` entry references the extension, then everything
   is already gone — stop and tell the user:
   - `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
   - `$env:USERPROFILE\.claude\commands\kick.md`
   - `$env:APPDATA\Code\User\globalStorage\local.claude-limit-meter`
   - `$env:APPDATA\Code\User\workspaceStorage\*\local.claude-limit-meter`

2. Delete the slash command file:
   - `$env:USERPROFILE\.claude\commands\kick.md`
   The `commands/` folder itself MUST stay — it can hold other slash
   commands from Claude Code or from other extensions.

3. Belt-and-braces for users coming straight from v0.4.x to fully
   gone (v0.5.0 already cleans these on activate, but a user who
   skipped v0.5.0 entirely will still have these). Remove if present:
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

5. Patch `$env:USERPROFILE\.vscode\extensions\extensions.json` (if
   the file exists):
   - read the JSON array;
   - remove every entry with `identifier.id == "local.claude-limit-meter"`
     or with `relativeLocation` starting with `local.claude-limit-meter-`;
   - write atomically (temp file + rename).

6. Patch `$env:USERPROFILE\.vscode\extensions\.obsolete` (if the
   file exists):
   - the file is a JSON object whose keys are extension folder names
     (e.g. `local.claude-limit-meter-0.4.2`) and values are `true`;
   - remove every key starting with `local.claude-limit-meter-`;
   - if the object becomes `{}`, leave the file as `{}` (do NOT
     delete it — VS Code re-creates it on next launch);
   - write atomically.

7. Clean VS Code per-extension storage. These are folders VS Code
   creates for any extension that calls `globalState`/`workspaceState`
   or stores a webview cache, even if the current version of the
   extension does not write into them. Old versions may have:
   - `$env:APPDATA\Code\User\globalStorage\local.claude-limit-meter`
     → `Remove-Item -Recurse -Force` if present.
   - `$env:APPDATA\Code\User\workspaceStorage\*\local.claude-limit-meter`
     → enumerate every workspace hash subfolder and remove the
     `local.claude-limit-meter` subfolder inside, if present. Do NOT
     remove the workspace hash folder itself — other extensions store
     state there.

   Insiders / Code-OSS variants live under `Code - Insiders` and
   `Code - OSS` respectively. Repeat step 7 for any of these that
   exist on this machine.

8. Verification (each check must pass; if any fails, report what
   failed — do NOT try to recover by restoring a backup of
   `settings.json` or `extensions.json`):
   - `Test-Path` on every path from steps 2, 3, 4, 7 returns `False`;
   - `~/.claude/settings.json` parses as valid JSON and contains no
     substring `kick-hook.js`;
   - `~/.vscode/extensions/extensions.json` parses as valid JSON and
     contains no substring `local.claude-limit-meter`;
   - `~/.vscode/extensions/.obsolete` parses as valid JSON and
     contains no key starting with `local.claude-limit-meter-`.

9. Final report. List:
   - every path that was deleted (one per line);
   - which JSON files were patched and how many entries were removed
     from each;
   - the explicit line:
     "VS Code is still running with stale extension state in memory.
     Quit ALL VS Code windows (File -> Exit, or close the last
     window). Developer: Reload Window is NOT enough — it reuses
     the same extension host process and the webview cache will
     survive. You do this yourself."

Forbidden:
- deleting `~/.claude/` or `~/.vscode/extensions/` wholesale;
- deleting workspace hash folders under `workspaceStorage\<hash>\`;
- editing `settings.json`, `extensions.json`, or `.obsolete` without
  an atomic write;
- skipping verification;
- using `Developer: Reload Window` as a substitute for a full quit.
```
