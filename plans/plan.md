# v0.5.0 — Strip cc-ctx and PostCompact hook, ship only `limit` button and `/kick` slash command

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This plan follows `PLANS.md` at the repository root.

## Purpose / Big Picture

After this change a user installs one `.vsix`, reloads VS Code, and sees exactly one extension surface: a status bar item labelled `limit` that opens a webview panel showing Anthropic quota (5 hour rolling block and 7 day block, plus the project's `/context` breakdown). No second status item exists, no third status item exists, no automatic PostCompact hook tries to write to the chat, no Russian text appears anywhere in the user interface or in the prompts shipped with the extension.

The current v0.4.2 extension carries three pieces that the user has decided to retire:

  - A `cc-ctx` status bar item that polls local session JSONL files and shows a colored bar with a context-fill percent. The math is correct, but the data flow duplicates what Claude Code already displays in its own footer, so the user does not want this surface any more.
  - A small `🟢/⚪` status bar dot that toggled a `~/.claude/.kick-disabled` marker file used by an auto-installed PostCompact hook (`~/.claude/scripts/kick-hook.js`). The hook was supposed to print a copy-ready handoff block to chat after `/compact`. In practice, Claude Code's PostCompact event is officially still a feature request and the `systemMessage` channel that this hook used is silently dropped in the VS Code Claude Code extension. The hook fires but nothing ever appears in the chat window. The user verified this on screen with several screenshots over the previous session.
  - Two ancillary slash commands `/kick-on` and `/kick-off` that only manipulated the disabled marker. They are now meaningless because the hook itself is being removed.

The user gains a smaller, calmer extension surface (one button, one webview, predictable). The user keeps one piece that *is* proven to work: the manual `/kick` slash command, which generates a handoff block by reading recent JSONL summaries and prints it as a regular chat message with a Copy button. Because `/kick` is just a Claude Code skill (a markdown file in `~/.claude/commands/`), it does not depend on hook delivery and is unaffected by the PostCompact platform bug.

How to see it working after this change:

  1. Run `./install.ps1` from the repository root.
  2. In VS Code, run command `Developer: Reload Window`.
  3. Look at the bottom-right of the status bar. Exactly one new item appears: `$(pulse) limit`. There is no `cc-ctx ▓▓▓▓ NN%` and no `🟢` or `⚪` dot anywhere. The leftover `cc-ctx` and dot from the prior v0.4.2 install are gone after the reload.
  4. Click `limit`. A webview panel opens titled "Claude Quota" with the same quota and `/context` content that v0.4.2 already provides.
  5. Open any Claude Code chat (CLI or VS Code panel). Type `/kick`. The chat shows a fenced markdown block with a Copy button at the top right. Click Copy, paste into a fresh chat, the new chat is oriented from the source repository alone.
  6. Open `~/.claude/scripts/`. There is no `kick-hook.js` file. Open `~/.claude/commands/`. There is exactly one file `kick.md` and no `kick-on.md` or `kick-off.md`. Open `~/.claude/settings.json`. There is no `hooks.PostCompact` entry that contains the string `kick-hook.js`.

## Progress

  - [x] (2026-06-29 02:50Z) Read `PLANS.md` skeleton in full and confirmed the single-`md`-fence rule does not apply when the file's content *is* the plan.
  - [x] (2026-06-29 02:50Z) Probed user's `~/.claude/` and confirmed the legacy artifacts that the new activate handler must clean up: `scripts/kick-hook.js`, `commands/kick.md`, `commands/kick-on.md`, `commands/kick-off.md`, `.kick-log`, `.kick-installed-version`. The `.kick-disabled` marker is absent.
  - [x] (2026-06-29 02:55Z) Wrote this plan to `plans/plan.md` per the user's instruction "Создай план работ по шаблону... положи в plans/plan.md".
  - [x] (2026-06-29 03:40Z) Rewrote `extension.js`, `package.json`, `resources/kick.md` (EN), `README.md`, `README_ru.md`, `CLAUDE.md`, `prompts/uninstall-full.md` (EN). Deleted `resources/kick-hook.js`, `resources/kick-on.md`, `resources/kick-off.md`, `prompts/uninstall-vsix-only.md`. `git diff --stat HEAD` shows 11 modified/deleted files, -1226 lines net. Session compacted before build/install/commit/push/release steps — handoff to fresh chat below.
  - [ ] Rewrite `extension.js` from 1146 lines down to the minimal surface: keep the `limit` status bar item, the `Claude Quota` webview, `cleanupOlderInstalls`, `compareSemver`, `getTextColor`, the `fetchPlanName`, `fetchQuotaData`, `fetchContextData`, `parseContextOutput`, `buildFullHtml`, `buildContextResultHtml`, `buildLimitErrorHtml`, `barHtml`, `fmtResetTime`, `fmtRemaining`, `readOAuthToken`, `HEADERS`, `getClaudeHome`, `openUsagePage`, `showLimitPanel`; add `ensureKickSkill` that copies `resources/kick.md` to `~/.claude/commands/kick.md`; add `cleanupLegacyKickArtifacts` that removes all six legacy paths and patches `settings.json` to drop the PostCompact entry.
  - [ ] Rewrite `package.json`. Bump version to `0.5.0`. Keep only commands `claudeLimitMeter.openUsagePage` and `claudeLimitMeter.showLimit`. Keep only config keys `usagePageUrl`, `statusBarPriority`, `textColor`. Drop everything else.
  - [ ] Translate `resources/kick.md` to English in full. Preserve the JSONL extraction `node -e` block unchanged because that logic is what makes the skill work.
  - [ ] Delete `resources/kick-hook.js`, `resources/kick-on.md`, `resources/kick-off.md`.
  - [ ] Rewrite `README.md` (English) and `README_ru.md` (Russian) to describe only the `limit` button and the `/kick` slash command. Update the download badges from `v0.4.1` to `v0.5.0`. Remove every paragraph that talks about `cc-ctx`, the kick dot, the PostCompact hook, the kick-on/kick-off commands, the kick log, the context-percent formula, the context window detection table, and the long list of removed settings keys.
  - [ ] Rewrite `CLAUDE.md` (contributor protocol) to reflect the new minimal scope. Drop §5 (context-percent formula), §6 (kick hook artifacts), §11.3 (formula divergence ban), §11.5 (rename/delete `resources/*` ban). Keep §1, §2 (updated file layout), §3, §4, §7, §8, §9, §10.
  - [ ] Rewrite `prompts/uninstall-full.md` in English. The new content only needs to: remove the extension folder, patch `extensions.json`, and optionally delete `~/.claude/commands/kick.md`. There is no `settings.json` PostCompact entry to remove because v0.5.0 never writes one. The agent prompt no longer mentions kick-hook.js, kick-on.md, kick-off.md, .kick-installed-version, .kick-disabled, .kick-log.
  - [ ] Delete `prompts/uninstall-vsix-only.md`. With no hook there is only one mode of uninstall and the file is now redundant.
  - [ ] Add `plans/**` to `.vscodeignore` so the plan does not ship inside the `.vsix`.
  - [ ] Build `claude-limit-meter-0.5.0.vsix` using `npx @vscode/vsce package --baseContentUrl "file:///./" --allow-missing-repository`.
  - [ ] Run `./install.ps1` and verify it succeeds with `REMOVED=`, `INSTALLED=`, `REGISTRY_UPDATED=0.5.0` lines.
  - [ ] Commit the change to `main` with a message that flags the breaking removal.
  - [ ] Push to `origin/main` using the ignored `GIT_ASKPASS` helper (see §16.1 of `~/.claude/CLAUDE.md`).
  - [ ] Create GitHub Release `v0.5.0` with the VSIX attached using `gh release create`.

## Surprises & Discoveries

  - Observation: VS Code Claude Code extension silently swallows the `systemMessage` channel that PostCompact hooks use to render a chat message. The hook process fires (verified via `~/.claude/.kick-log`) but the JSON it writes to stdout never reaches the chat UI.
    Evidence: GitHub issues anthropics/claude-code#15344, #50542, #16289 confirm the platform-side bug. The same hook output in the same shape is rendered correctly when delivered through manual slash command paths (`/kick`), because slash commands go through the regular assistant message pipeline rather than the system message overlay.
  - Observation: PostCompact as a hook event is itself an open feature request in the Claude Code repository, not a shipped feature. The current implementation appears to fire the hook but does not contract any rendering of its output.
    Evidence: GitHub issues anthropics/claude-code#14258, #17237, #32026, #39099, #40492 — all listed as feature requests or unconfirmed bug reports, none closed as fixed.
  - Observation: VS Code does not call an extension's `deactivate()` function when the extension is uninstalled. Anything an extension wrote into `~/.claude/` survives the uninstall.
    Evidence: Behavior is documented in `vscode.ExtensionContext.subscriptions` docs. The previous v0.4.x had to ship a `prompts/uninstall-full.md` prompt explicitly because of this. v0.5.0 keeps this discipline: the only on-disk artifact it ever writes is one optional file (`~/.claude/commands/kick.md`), which the uninstall prompt mentions as removable.

## Decision Log

  - Decision: Remove all PostCompact hook infrastructure outright instead of patching it.
    Rationale: The hook output channel is broken at the platform layer (see Surprises). The fix is not in our control. Continuing to ship the hook gives users a status bar dot that promises a feature that does not work in their environment. A breaking removal in `0.5.0` is honest; carrying broken infrastructure on the hope of a future platform fix is not.
    Date/Author: 2026-06-29 / cleverplant via Claude Code

  - Decision: Bump to `0.5.0`, not `0.4.3`.
    Rationale: The change removes three configuration keys, four commands, two slash commands the user may have come to rely on, and one status bar dot whose color was visible at all times. That is a breaking change to anyone who scripted around those names, and semver says breaking changes bump the minor (or major) component, not the patch component.
    Date/Author: 2026-06-29 / cleverplant via Claude Code

  - Decision: Keep `kick.md` skill as the single shipped artifact, translated to English.
    Rationale: The slash command path renders fine in every Claude Code surface tested. The skill is self-contained Markdown plus an inline `node -e` block that reads JSONL. It carries no platform-bug dependency. English matches the rest of the public-facing repo strings.
    Date/Author: 2026-06-29 / cleverplant via Claude Code

  - Decision: Auto-clean legacy `~/.claude/` artifacts on every `activate()`, idempotent.
    Rationale: Existing v0.4.x users who upgrade should not have to read the README and manually delete files. Cleanup is best-effort and silent (no popups), so a user who already cleaned up sees nothing, and a user who never cleaned up gets cleaned up on next reload.
    Date/Author: 2026-06-29 / cleverplant via Claude Code

  - Decision: Delete `prompts/uninstall-vsix-only.md`.
    Rationale: That file documented a "keep the hook, drop the UI" mode that no longer makes sense once the hook is gone. The remaining `uninstall-full.md` covers the only remaining path.
    Date/Author: 2026-06-29 / cleverplant via Claude Code

## Outcomes & Retrospective

  Pending — will be filled in when the GitHub release is published and the user confirms the VS Code reload shows only the `limit` button.

## Context and Orientation

The working copy lives at `C:\Users\Admin\Documents\PlatformIO\claude-limit-meter` on a Windows machine. The repository is a public GitHub repository at `https://github.com/cleverplant/claude-limit-meter`. The default branch is `main`. The current commit before this work begins is `edc8cdf fix: kick-hook PostCompact dumped full session summary (0.4.2)`.

Key paths a novice contributor must understand:

  - `extension.js` — every line of runtime logic. No bundler, no TypeScript, no source map. VS Code loads this file directly. The current file is 1146 lines and mixes three responsibilities: the `cc-ctx` JSONL scanner, the `limit` webview, and the kick hook installer. This plan replaces it with a roughly 350 line file that keeps only the `limit` webview, an `ensureKickSkill` function that drops one Markdown file into the user's home directory, and a `cleanupLegacyKickArtifacts` function that deletes the v0.4.x leftovers.
  - `package.json` — the VS Code extension manifest. Lists commands shown in the command palette and settings shown in the VS Code settings UI. After this change it lists two commands (`openUsagePage`, `showLimit`) and three settings (`usagePageUrl`, `statusBarPriority`, `textColor`).
  - `install.ps1` — a PowerShell script that copies the working tree into `~/.vscode/extensions/local.claude-limit-meter-<version>` and patches the VS Code `extensions.json` registry so VS Code does not warn "invalid extension detected". `install.ps1` reads the version from `package.json` at runtime, so we never edit it for a version bump.
  - `resources/` — files shipped inside the `.vsix` and intended to be copied into the user's `~/.claude/`. Before this change there are four files in this directory; after, there is exactly one (`kick.md`).
  - `prompts/` — copy-ready agent prompts that perform uninstall via filesystem operations from outside VS Code. Used by users who cannot or do not want to click in the VS Code UI.
  - `~/.claude/` — Claude Code's own home directory. The extension touches three places inside it: (1) reads `.credentials.json` for an OAuth token to call Anthropic's quota endpoint, (2) writes `commands/kick.md` to install the slash command, (3) deletes the v0.4.x legacy files.
  - `C:\Tools\claude-wrap.exe` — a small native wrapper the user already has, used by `fetchContextData` to run the `/context` CLI command and capture its stdout. The path is hard-coded in `extension.js`. This is acceptable for a local-only extension; if the path moves, the `/context` block in the webview shows an error message instead of crashing.

Terms used in this plan with their plain-English meanings:

  - "Status bar item" — the small clickable label at the bottom of the VS Code window, on the right side.
  - "Webview panel" — a small HTML page that VS Code can render inside its own window. The Quota panel that opens when you click `limit` is a webview.
  - "Slash command" / "skill" — a Markdown file in `~/.claude/commands/` whose name (minus `.md`) becomes a `/<name>` command in Claude Code chats. The body of the file is sent to the model as instructions when the user types the command.
  - "PostCompact hook" — a process Claude Code spawns after it auto-summarizes a chat to free up context. Configured in `~/.claude/settings.json` under `hooks.PostCompact`. The process can emit JSON to stdout to influence the next message; in the VS Code Claude Code extension specifically, the `systemMessage` field of that JSON is silently dropped, which is why this plan removes the hook entirely.
  - "VSIX" — the binary distribution format for VS Code extensions, produced by `vsce package`.
  - "JSONL" — JSON Lines, one JSON object per text line. Claude Code persists session history as JSONL files under `~/.claude/projects/<encoded-cwd>/`.

## Plan of Work

Step one is to write the new `extension.js`. The new file keeps the architecture of the current `limit` button surface but discards everything that touched JSONL scanning, the cc-ctx item, the kick item, the toggle marker, and the PostCompact hook installer. New code is added in two well-named functions:

  - `cleanupLegacyKickArtifacts()` — runs on every `activate()`. Deletes `~/.claude/scripts/kick-hook.js`, `~/.claude/commands/kick-on.md`, `~/.claude/commands/kick-off.md`, `~/.claude/.kick-installed-version`, `~/.claude/.kick-disabled`, `~/.claude/.kick-log`. Reads `~/.claude/settings.json`, removes from `hooks.PostCompact` any entry whose hook command contains the substring `kick-hook.js`, deletes the `PostCompact` key if its array becomes empty, deletes the `hooks` key if it becomes empty, writes the result back. Wrapped in a try/catch so a malformed settings.json never blocks activation.
  - `ensureKickSkill(context)` — runs on every `activate()`. Reads `resources/kick.md` from the extension folder, writes it to `~/.claude/commands/kick.md`. Idempotent overwrite — no version marker file needed because the file is small and a fresh copy on every activate is fine.

Step two is to rewrite `package.json`. The new manifest carries two commands (`claudeLimitMeter.openUsagePage`, `claudeLimitMeter.showLimit`) and three configuration keys (`claudeLimitMeter.usagePageUrl`, `claudeLimitMeter.statusBarPriority`, `claudeLimitMeter.textColor`). The version becomes `0.5.0`. The `activationEvents`, `engines.vscode`, `repository`, `bugs`, `homepage`, `license`, `icon`, and `categories` fields stay as they were.

Step three is the slash command file. `resources/kick.md` is translated to English in full. Every Russian phrase ("скопируй", "Откройте новый чат", "Внимание", "Полный контекст", "возраст") is replaced by an English equivalent ("copy", "Open a new chat", "Warning", "Full context", "age"). The `node -e` block stays byte-for-byte the same because changing it would change behavior. After translation the file becomes the only artifact under `resources/`.

Step four is to delete `resources/kick-hook.js`, `resources/kick-on.md`, `resources/kick-off.md`. After this step the directory contains only `kick.md`.

Step five is to rewrite both `README.md` and `README_ru.md`. The new READMEs describe one status bar button, one webview, one slash command. The download badge points at `v0.5.0`. The data sources table loses the `cc-ctx %` row. The "All settings keys" section shrinks to three lines. The "Kick hook — files deployed" section is replaced by a "What the `/kick` skill does" section. The two READMEs stay structurally parallel per the existing project rule.

Step six is to rewrite `CLAUDE.md`. Sections that no longer apply are dropped, the file layout in §2 is updated, the rest stays.

Step seven is to rewrite `prompts/uninstall-full.md` in English. The new file is shorter because there is no `settings.json` to patch and only one optional file in `~/.claude/` to delete.

Step eight deletes `prompts/uninstall-vsix-only.md`.

Step nine adds `plans/**` to `.vscodeignore` so the plan does not bloat the VSIX.

Step ten is to build the VSIX. The command is `npx --yes @vscode/vsce package --baseContentUrl "file:///./" --allow-missing-repository`. This drops `claude-limit-meter-0.5.0.vsix` into the repo root.

Step eleven runs `./install.ps1`. The expected output ends with `REGISTRY_UPDATED=0.5.0`. After this the user runs `Developer: Reload Window` to see the new surface.

Step twelve commits the change. The commit message names the breaking removal explicitly so anyone scanning git log understands why the configuration schema shrank.

Step thirteen pushes to `origin/main`.

Step fourteen creates a GitHub Release `v0.5.0`. The release notes summarize the breaking removal and the remaining surface. The VSIX is attached as a release asset.

## Concrete Steps

All commands assume the working directory is `C:\Users\Admin\Documents\PlatformIO\claude-limit-meter` and the shell is bash on Windows (as used by the Claude Code session). Where PowerShell syntax is unavoidable (the VSIX build, the install script) the command is wrapped via `powershell -NoProfile -Command ...`.

  Step 1 — write `extension.js` per the function inventory described above. Verify it parses with `node --check extension.js` and expect no output on success.

  Step 2 — write `package.json` with version `0.5.0`. Verify with `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` and expect no output on success.

  Step 3 — translate `resources/kick.md` to English. Verify with `grep -n 'скопируй\|Откройте\|Внимание\|Полный контекст\|возраст' resources/kick.md` and expect zero matches.

  Step 4 — delete the three legacy resources files:

      rm resources/kick-hook.js resources/kick-on.md resources/kick-off.md

  Step 5 — rewrite `README.md` and `README_ru.md`. Verify both reference `v0.5.0` in their download badge.

  Step 6 — rewrite `CLAUDE.md` to drop the four sections listed in the Plan of Work.

  Step 7 — rewrite `prompts/uninstall-full.md` in English.

  Step 8 — delete `prompts/uninstall-vsix-only.md`.

  Step 9 — add the single line `plans/**` to `.vscodeignore` in the "Dev-only artifacts" block.

  Step 10 — build the VSIX:

      powershell -NoProfile -Command "npx --yes @vscode/vsce package --baseContentUrl 'file:///./' --allow-missing-repository"

  Expected tail of output:

      DONE  Packaged: ...\claude-limit-meter-0.5.0.vsix

  Step 11 — run the local installer:

      powershell -NoProfile -Command "./install.ps1"

  Expected tail:

      INSTALLED=...\local.claude-limit-meter-0.5.0
      REGISTRY_UPDATED=0.5.0
      Reload VS Code: Developer: Reload Window

  Step 12 — commit. Stage only files we actually intend to ship.

      git add extension.js package.json resources/ README.md README_ru.md CLAUDE.md prompts/ .vscodeignore plans/ PLANS.md
      git status --short
      git commit -m "feat!: v0.5.0 — strip cc-ctx and PostCompact hook ..."

  Step 13 — push:

      git -c credential.helper= push -u origin main

  Step 14 — create the release. The VSIX path is the absolute path output by step 10.

      gh release create v0.5.0 ./claude-limit-meter-0.5.0.vsix --title "v0.5.0 — Quota button only" --notes "..."

## Validation and Acceptance

The change is accepted when all of the following are true and the user has confirmed them by eye:

  - `node --check extension.js` exits with status 0 and prints nothing.
  - `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` exits with status 0 and prints nothing.
  - `grep -rn 'cc-ctx\|kickItem\|statusItem\|toggleKickHook\|reinstallKickHook\|uninstallKickHook\|toggleBar\|readLatestSnapshot\|readKickState\|renderKick' extension.js` returns zero lines.
  - The repository contains exactly four files under `resources/` and `prompts/` combined: `resources/kick.md`, `prompts/uninstall-full.md`. (`kick-hook.js`, `kick-on.md`, `kick-off.md`, and `uninstall-vsix-only.md` are gone.)
  - `git ls-files resources/ prompts/` confirms the same four-file state in git.
  - `./install.ps1` ends with the lines shown in step 11.
  - After `Developer: Reload Window`, the VS Code status bar at the bottom right shows exactly one new item: `$(pulse) limit`. There is no `cc-ctx` text, no `▓`-style bar, no `🟢` or `⚪` dot. (Other extensions' items are unaffected.)
  - Clicking `limit` opens the Claude Quota panel. The quota numbers, plan badge, and `/context` block all render.
  - `~/.claude/scripts/kick-hook.js` does not exist.
  - `~/.claude/commands/kick.md` exists and its first line is `---`.
  - `~/.claude/commands/kick-on.md` and `~/.claude/commands/kick-off.md` do not exist.
  - `~/.claude/.kick-installed-version`, `~/.claude/.kick-log`, `~/.claude/.kick-disabled` do not exist.
  - Reading `~/.claude/settings.json` and searching for `kick-hook.js` returns zero matches. The file is valid JSON.
  - Typing `/kick` in any Claude Code chat produces a single fenced code block with a Copy button in its top-right corner, English prose inside.
  - `gh release view v0.5.0` shows the VSIX as a release asset and the release notes.

## Idempotence and Recovery

Every step in this plan is safe to repeat. `extension.js`, `package.json`, the READMEs, `CLAUDE.md`, and the prompt files are overwritten in full by their new contents; running the rewrite a second time produces the same result. Deleting `resources/kick-hook.js`, `resources/kick-on.md`, `resources/kick-off.md` is idempotent because `rm` of a missing file in this plan should be guarded with `rm -f`. The activate-time cleanup function is idempotent by construction: every filesystem delete is wrapped in try/catch and re-running it on an already-clean home directory is a no-op.

If `vsce package` fails because the working tree is dirty in an unexpected way, fix the immediate issue (usually a stray `node_modules` or a stale `*.vsix`) and re-run the same command.

If `./install.ps1` fails because an older `local.claude-limit-meter-*` folder is locked by a still-running VS Code window, close that window and re-run.

If `git push` fails because the local branch is behind, run `git pull --ff-only` and try again; do not force-push. The user must approve any non-fast-forward.

If `gh release create` fails because a release with that tag already exists, the recovery is `gh release delete v0.5.0 -y --cleanup-tag` followed by re-running the create. The user must approve this destructive step before the agent takes it.

The activate-time cleanup never touches anything outside the six legacy paths and the one `hooks.PostCompact` entry, so re-running activate is harmless even on a heavily customized `~/.claude/settings.json`.

## Artifacts and Notes

Expected tail of `npx --yes @vscode/vsce package ...`:

      Files included: 9
      DONE  Packaged: C:\Users\Admin\Documents\PlatformIO\claude-limit-meter\claude-limit-meter-0.5.0.vsix (NN files, NN KB)

Expected tail of `./install.ps1`:

      REMOVED=C:\Users\Admin\.vscode\extensions\local.claude-limit-meter-0.4.2
      INSTALLED=C:\Users\Admin\.vscode\extensions\local.claude-limit-meter-0.5.0
      REGISTRY_UPDATED=0.5.0
      Reload VS Code: Developer: Reload Window

Expected `git log --oneline -1` after step 12:

      <new-hash> feat!: v0.5.0 — strip cc-ctx and PostCompact hook, keep limit button and /kick skill

## Interfaces and Dependencies

The runtime depends only on:

  - Node built-ins `fs`, `path`, `os`, `child_process` (already in v0.4.2).
  - VS Code Extension API surfaces `vscode.window.createStatusBarItem`, `vscode.window.createWebviewPanel`, `vscode.commands.registerCommand`, `vscode.workspace.getConfiguration`, `vscode.env.openExternal`, `vscode.Uri.parse`, `vscode.StatusBarAlignment`, `vscode.ViewColumn`. (Same as v0.4.2; nothing new.)
  - The Anthropic OAuth endpoints `https://api.anthropic.com/api/oauth/usage` and `https://api.anthropic.com/api/oauth/profile`, called with the access token from `~/.claude/.credentials.json`.
  - `C:\Tools\claude-wrap.exe` for the `/context` block, as today.

In `extension.js`, define and export:

      function activate(context)
      function deactivate()

Where `activate` does, in order:

      cleanupOlderInstalls(context)        // unchanged from v0.4.2
      cleanupLegacyKickArtifacts()         // new
      ensureKickSkill(context)             // new
      limitItem = vscode.window.createStatusBarItem(...)
      register commands openUsagePage and showLimit

There must be no other `createStatusBarItem` call and no `setInterval` timer in the file.

The settings schema in `package.json` must be exactly:

      claudeLimitMeter.usagePageUrl        : string, default "https://claude.ai/settings/usage"
      claudeLimitMeter.statusBarPriority   : number, default 999
      claudeLimitMeter.textColor           : string, default "#1b003f"

The commands schema must be exactly:

      claudeLimitMeter.openUsagePage  : "Claude Limit Meter: Open Usage Page (claude.ai)"
      claudeLimitMeter.showLimit      : "Claude Limit Meter: Show Quota Limits"

---

Change note (2026-06-29 02:55Z): initial creation. Plan written in response to the user's explicit instruction to autonomously refactor the extension and capture the work in `plans/plan.md` per the `PLANS.md` template. The plan is self-contained — a contributor starting from this file alone should be able to ship the same `v0.5.0`.

---

## Stage 2 — README clarity pass (added 2026-06-29, deferred)

**Status:** queued. User asked to capture requirements only; execution paused because the user's Anthropic 5h/7d account quota is running low — work resumes in this same chat once quota resets (or sooner if the user explicitly says continue). Do NOT assume a chat handoff is needed.

**Version question open:** the user has NOT yet decided whether this is a v0.5.1 bump or a v0.5.0 re-cut (delete tag + re-publish under the same tag). The plan below is written for v0.5.1 as the safe default; if the user picks the re-cut path, replace every "v0.5.1" with "v0.5.0", skip the package.json version bump, and add `gh release delete v0.5.0 --yes --cleanup-tag` as the first step before re-pushing the tag. Ask once at resume time before doing either.

### What the user asked for, verbatim

> 1) В обоих README НУЖНО СКОРРЕКТИРОВАТЬ ТЕКСТ. Где то в САМОМ НАЧАЛЕ ДАТЬ ИНФОРМАЦИЮ о том, ЧТО первый блок Anthropic quota актуален для Вашего аккаунта и не имеет привязки к используемой модели CLI или Claude Code for VS Code? а второй блок инфо панели имеет отношение только к CLI. Там что то есть про это, но надо убрать прежнее предупреждение, а сделать общее, чтобы в самом начале пользователь понимал, что это за расширение - что оно ему дает!
>
> 2) на самый верх помести актуальные скриншоты сначала этот: `C:\Users\Admin\Documents\PlatformIO\claude-limit-meter\quota.png` а ниже этот: `C:\Users\Admin\Documents\PlatformIO\claude-limit-meter\limit.png`.
>
> 3) проделать все операции соответственно с самим расширением, чтобы при установке юзер видел исправленное описание.
>
> 4) проделать все операции с гитхабом И релизом.

### Screenshot files

The user clarified in a follow-up message:

- Top: `claude-limit-meter\quota.png` — the Anthropic quota block.
- Below: `claude-limit-meter\limit.png` — the `/context` block (or whatever the limit panel detail view looks like; verify by opening the file).

Verify both files exist on disk before starting work; if either is missing, ask the user.

### Goal of the README pass

Replace the existing top-of-page "Heads-up about data source" callout with a short, neutral **"What this extension gives you"** intro at the very top of both READMEs (English and Russian, structurally parallel). The new intro must make these two points unambiguous before any technical detail:

1. **First panel block — Anthropic quota (5h + 7d).** Tied to your **Anthropic account**, not to which model you happen to use, not to where you launched Claude Code from (CLI vs VS Code Claude Code panel). The numbers come straight from Anthropic's `oauth/usage` endpoint. They reflect plan billing, not session state.
2. **Second panel block — `/context`.** Tied **only to the CLI**. It spawns a fresh CLI sub-session in the chosen workspace folder and parses `/context` output. It does **not** show what the VS Code Claude Code GUI panel sees in its live session. The model name and percentages can differ from the GUI panel.

The current top callout (`> Heads-up about data source. ...`) explains the same thing but only as a warning about discrepancy. Reframe positively: tell the user what each block *is for* first, and only after that mention the GUI/CLI divergence as a corollary.

### Concrete work when work resumes (in order)

1. **Confirm with user: v0.5.1 bump or v0.5.0 re-cut?** Default-assume v0.5.1 if no answer. If re-cut, replace every `0.5.1` below with `0.5.0` and start with `gh release delete v0.5.0 --yes --cleanup-tag` + `git tag -d v0.5.0` + `git push origin :refs/tags/v0.5.0`.
2. **Confirm both screenshot files exist** at `quota.png` and `limit.png` in the repo root.
3. **Bump version to `0.5.1` in `package.json`** (skip if user picked re-cut).
4. **Edit `backup frontend/index.html`?** — No. This project's frontend rule (CLAUDE.md §1, §4) applies to the ESP32-S3 project, not to `claude-limit-meter`. In `claude-limit-meter` the only "frontend" is the webview HTML built in `extension.js`'s `buildFullHtml`; the README is not an HTML build artifact and does not need a gzip rebuild.
5. **Drop the two screenshots into the repo root** (if not already there). Verify each is a valid PNG with `node -e "const b=require('fs').readFileSync('quota.png');console.log(b.slice(0,8).toString('hex'))"` — expect `89504e470d0a1a0a`.
6. **Add a new "What's new in 0.5.1" section** at the top of both READMEs (after the download badge line, before the screenshots). Keep it to 2–3 lines: "Clarified that the quota block reflects your Anthropic account (not the CLI model), and that the `/context` block reflects CLI state only (not the GUI Claude Code panel). Two screenshots at the top now show both panel blocks separately."
7. **Replace the current top callout** in both READMEs with the new positive-framing intro. Keep the GUI/CLI divergence note, but as a sentence inside the intro, not as a leading warning.
8. **Swap the screenshot at the very top.** Remove the existing single `claude-limit-web.png` reference at the top of both READMEs. Insert two consecutive image references (the two files from step 1), each with descriptive alt text ("Anthropic quota — 5h and 7-day blocks" and "Project context (/context) — model + token breakdown" or whatever fits).
9. **Decide on `claude-limit-web.png`:** if it is now redundant after the two new screenshots, mark it for removal in the same commit; otherwise leave it in place if it still appears lower in the README. Same question for `status-bar.png` (already unreferenced — fold the cleanup into this commit). Ask user if unsure.
10. **Mirror all changes between `README.md` and `README_ru.md`** per CLAUDE.md (the project's own CLAUDE.md, not the ESP32-S3 one) §6.
11. **Rebuild VSIX:** `powershell -NoProfile -Command "npx --yes @vscode/vsce package --baseContentUrl 'file:///./' --allow-missing-repository"`. Expect `claude-limit-meter-0.5.1.vsix`.
12. **Inspect the .vsix file list** (vsce prints it) and confirm both new screenshots are inside. If `.vscodeignore` excludes them by pattern, fix.
13. **Run `./install.ps1`** locally. Expect `REGISTRY_UPDATED=0.5.1`.
14. **Reload window** and visually confirm the README on the extension's marketplace pane (Extensions panel → Claude Limit Meter → README tab) shows the two new screenshots at the top in correct order with correct alt text.
15. **Commit** with message `docs: clarify quota vs /context scope, refresh top screenshots (v0.5.1)`. Stage explicit paths only: `package.json`, `README.md`, `README_ru.md`, the two new `*.png` files, and any cleanup of old screenshots.
16. **Push** via the ignored GIT_ASKPASS helper (same flow as v0.5.0).
17. **Create GitHub Release v0.5.1** with the new VSIX attached, notes summarizing what changed and crediting v0.5.0 as the latest functional release (no code changes in v0.5.1).
18. **Update v0.5.0 release notes** to add a one-line pointer at the bottom: "v0.5.1 docs follow-up clarifies quota vs /context scope — VSIX is functionally identical."

### Forbidden during this stage

- Do NOT touch `extension.js`, `package.json` settings/commands schema, or `resources/kick.md`. This is a docs-only stage.
- Do NOT re-introduce the cc-ctx / PostCompact surface — see "Forbidden" in Stage 1.
- Do NOT delete `claude-limit-web.png` without explicit user OK if it is still referenced anywhere in the READMEs.
- Do NOT push a v0.5.1 release that contains code changes alongside the docs change. If a code fix is needed, ship it as v0.5.2 separately.

### Validation

Acceptance criteria for Stage 2:

- Both READMEs open with two consecutive screenshots, then a "What's new in 0.5.1" section, then the positive-framing intro that explains what each panel block represents.
- The phrase "Anthropic account" appears in the intro of both READMEs at least once.
- The phrase "CLI sub-session" or equivalent appears in the description of the second panel block.
- The old `> Heads-up about data source` callout is gone in both READMEs.
- `gh release view v0.5.1` shows the new VSIX as a release asset.
- The VS Code marketplace pane for the locally installed `local.claude-limit-meter-0.5.1` shows the two new screenshots at the top in correct order.
