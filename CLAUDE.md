# CLAUDE.md

Working protocol for Claude Code (and other AI coding agents) on this repository.

This is a small VS Code extension. The instructions below are focused: enough to ship a correct change without re-reading the whole codebase, and not more.

User-level rules in `~/.claude/CLAUDE.md` still apply (secrets discipline, git safety, no destructive commands without approval). This file does not repeat them.

---

## 1. What this project is

`Claude Limit Meter` — a local-only VS Code extension that shows current Claude Code context pressure and 5-hour / weekly token usage in the VS Code status bar. It also bundles a PostCompact auto-handoff hook for Claude Code (`/kick auto`).

The extension reads only local Claude Code session logs from `%USERPROFILE%\.claude\projects`. It does not call any Anthropic API, does not require an API key, and does not transmit user data anywhere.

Primary surfaces:
- `cc-ctx` — status bar item with percent + colored bar
- kick indicator — separate status bar item showing PostCompact hook ON/OFF
- Hover tooltip — model, context tokens, 5h block, weekly block

---

## 2. File layout

```
extension.js                       — all runtime logic (single file, no bundler)
package.json                       — manifest, commands, settings schema, version
install.ps1                        — local install to ~/.vscode/extensions + registry sync
resources/
  kick-hook.js                     — PostCompact hook body deployed to ~/.claude/scripts/
  kick.md                          — manual handoff slash command
  kick-on.md                       — enable PostCompact auto-handoff
  kick-off.md                      — disable PostCompact auto-handoff
README.md                          — English user-facing docs (also primary npm/marketplace text)
README_ru.md                       — Russian user-facing docs
claude-limit-web.png               — quota panel screenshot used in both READMEs
status-bar.png                     — status bar items screenshot used in both READMEs
LICENSE                            — MIT
.vscodeignore                      — controls what ships inside the .vsix
.gitignore                         — controls what reaches the public repo
```

There are no build/bundle/transpile steps. `extension.js` is plain Node/VS Code API JavaScript and is loaded as-is by VS Code.

---

## 3. Build / install workflow

Local install (used during development):

```powershell
./install.ps1
```

`install.ps1` does three things:
1. Removes any older `local.claude-limit-meter-*` folder under `~/.vscode/extensions`.
2. Copies current sources into `~/.vscode/extensions/local.claude-limit-meter-<version>`.
3. Patches `~/.vscode/extensions/extensions.json` so VS Code does not warn "invalid extension detected".

After install, run `Developer: Reload Window` in VS Code. This is mandatory — VS Code will not pick up changes otherwise.

Package a `.vsix` (for distribution outside this machine):

```powershell
vsce package --baseContentUrl "file:///./" --allow-missing-repository
```

The `--baseContentUrl` flag suppresses the "relative image URLs require a repository" warning so the screenshot in README.md is accepted. `--allow-missing-repository` lets packaging succeed before this repo has a remote URL — drop both flags once `repository` is set in package.json.

---

## 4. Versioning rules

This project uses semver. Every user-visible change bumps `version` in `package.json`.

When you change `version`:
1. Update `package.json`.
2. Add a "What's new in X.Y.Z" section at the top of **both** `README.md` and `README_ru.md`. The two files must stay structurally parallel — same sections, same order, same screenshot reference.
3. Run `./install.ps1`. It will purge the old install folder and update the VS Code registry to point at the new one.
4. Re-package the `.vsix` if you intend to ship it.

Do **not** edit version numbers in `install.ps1` — it reads from `package.json` at runtime. There is no second source of truth.

---

## 5. The context-percent formula (must match Claude Code's UI)

This is the single most important correctness contract in the extension. If the percent shown in `cc-ctx` diverges from what Claude Code itself shows in its bottom-right status, the extension has failed its job.

The formula (reverse-engineered from Claude Code's `vXe()` in `webview/index.js`):

```text
context_tokens   = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
effective_window = model_context_window − max_output_tokens − 13000
percent          = context_tokens / effective_window * 100
left_tokens      = max(0, effective_window − context_tokens)
```

The `13000` is Claude Code's reserved auto-compact safety margin and is a hard constant in the upstream codebase.

`resolveContextWindow(model)` and `resolveMaxOutput(model)` in `extension.js` encode the per-model values. When a new Claude model ships:
- If its context window is not 200k or 1M (`[1m]` suffix), extend `resolveContextWindow`.
- If its `maxOutputTokens` is not the 64k default (Opus 4.0/4.1 use 8192, Claude 3.x uses 8192), extend `resolveMaxOutput`.
- Verify by sending a real message in that model and comparing `cc-ctx` to Claude Code's own number. A 0.5% rounding gap is expected; anything larger is a bug.

---

## 6. Bundled `/kick` hook artifacts

The four files in `resources/` are deployed to the user's `~/.claude/` on first activate. Install is idempotent and version-tracked via `~/.claude/.kick-installed-version`.

When editing any `resources/*` file:
- Bump `KICK_HOOK_VERSION` in `extension.js` so existing users re-deploy on next activate.
- Make sure the hook still degrades gracefully if `node` is missing on PATH (the hook is invoked by Claude Code, which manages its own runtime).
- Test both kick-on and kick-off branches: the toggle marker is `~/.claude/.kick-disabled` (presence = OFF).

Do not delete or rename a `resources/*` file without coordinating with the deployment code in `extension.js`.

---

## 7. Two READMEs must stay in sync

`README.md` (English) and `README_ru.md` (Russian) are the primary user-facing docs. Both are bundled inside the `.vsix` (see `.vscodeignore`).

Structural rules:
- Same section order in both files.
- Same screenshot at the top.
- A new "What's new in X.Y.Z" section gets added to **both**, not just one.
- When fixing a typo or factual error in one, mirror it in the other in the same commit.

Different prose tone is fine; different structure or different content is a drift bug.

---

## 8. Secrets and what never reaches the public repo

This repo is intended for a **public** GitHub repository. Treat anything in the local working tree as potentially observable.

The following must never be staged or pushed:
- `.env` — contains `GITHUB_LOGIN`, `GH_TOKEN`, and any other automation secrets.
- `.secrets/` — local `git-askpass` helpers that read tokens from `.env`.
- `*.vsix` — build artifacts; users build their own or download from a release tag.
- `Screenshot_*.png` — dev-only screenshots used to reproduce issues.
- `fix-registry.js` and other ad-hoc temp scripts.

`.gitignore` enforces this at the git layer. `.vscodeignore` enforces it at the `vsce package` layer (so secrets cannot accidentally end up inside a published `.vsix` either).

Before the first `git add`, verify both ignores are active:

```powershell
git check-ignore -v .env .secrets/git-askpass.ps1
```

Both should report a match in `.gitignore`. If either does not, stop and fix the ignore — do not stage.

`claude-limit-web.png` and `status-bar.png` (the README screenshots) are **not** secret and must be committed: both READMEs reference them.

---

## 9. Testing

There is no automated test suite. Verification is manual and consists of:

1. `./install.ps1` succeeds (`REMOVED=...`, `INSTALLED=...`, `REGISTRY_UPDATED=...`).
2. `Developer: Reload Window` in VS Code.
3. Open any Claude Code session and confirm:
   - `cc-ctx` shows a percent and a colored bar.
   - The percent agrees with Claude Code's own bottom-right number (allow 0.5–1% rounding).
   - Hover tooltip renders without flicker on a static cursor for at least 30 seconds.
   - The kick indicator toggles when clicked, and `~/.claude/.kick-disabled` appears/disappears in sync.
4. Open a session with no recent `usage` entries and confirm the extension does not crash (status shows a neutral state).

If any of the above fails, do not package or release. Fix and reinstall first.

---

## 10. Tooling notes specific to this project

- **`vsce`** — install once globally: `npm i -g @vscode/vsce`. Run from the project root.
- **`install.ps1`** is Windows-only (PowerShell). The extension itself is cross-platform — only the local install helper depends on Windows paths. Linux/macOS users install via `code --install-extension <vsix>`.
- **No `node_modules`** are checked in or required at runtime. The extension uses only the VS Code API plus Node's built-in `fs`, `path`, and `os`. If you add a runtime dependency, also add a bundler step and revisit `.vscodeignore` — currently `node_modules/**` is excluded from the package.

---

## 11. Forbidden

1. Committing `.env`, `.secrets/`, or anything containing a real token / password / API key.
2. Pushing `.vsix` artifacts to the repo (use GitHub Releases instead).
3. Diverging the context-percent formula from Claude Code's `vXe()` without re-verifying against a live session.
4. Editing only one of `README.md` / `README_ru.md` for a user-visible change.
5. Renaming or deleting a `resources/*` file without updating the deployment code and bumping `KICK_HOOK_VERSION`.
6. Adding network calls to the extension. It is local-only by design; that is a stated guarantee in both READMEs.
