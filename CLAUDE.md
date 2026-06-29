# CLAUDE.md

Working protocol for Claude Code (and other AI coding agents) on this repository.

This is a small VS Code extension. The instructions below are focused: enough to ship a correct change without re-reading the whole codebase, and not more.

User-level rules in `~/.claude/CLAUDE.md` still apply (secrets discipline, git safety, no destructive commands without approval). This file does not repeat them.

---

## 1. What this project is

`Claude Limit Meter` — a small local-only VS Code extension that adds one status bar button (`limit`) which opens a Claude Quota web panel (Anthropic 5h / 7d quota and the project's `/context` block). On first activate it also installs one Claude Code slash command (`~/.claude/commands/kick.md`).

The extension talks to Anthropic only to fetch the OAuth-protected `/api/oauth/usage` and `/api/oauth/profile` endpoints — the same the CLI uses. It does not require a separate API key. It does not transmit chat content anywhere.

Primary surface:
- `limit` status bar item — click to open the Claude Quota web panel.
- `/kick` slash command — manual chat handoff, copied from `resources/kick.md` to `~/.claude/commands/kick.md` on activate.

---

## 2. File layout

```
extension.js                       — all runtime logic (single file, no bundler)
package.json                       — manifest, commands, settings schema, version
install.ps1                        — local install to ~/.vscode/extensions + registry sync
resources/
  kick.md                          — /kick slash command body (deployed to ~/.claude/commands/)
prompts/
  uninstall-full.md                — copy-ready agent prompt for full uninstall
plans/
  plan.md                          — the v0.5.0 refactor ExecPlan (contributor doc)
README.md                          — English user-facing docs (primary marketplace text)
README_ru.md                       — Russian user-facing docs
PLANS.md                           — ExecPlan template (root-level contributor doc)
claude-limit-web.png               — quota panel screenshot used in both READMEs
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
npx --yes @vscode/vsce package --baseContentUrl "file:///./" --allow-missing-repository
```

The `--baseContentUrl` flag suppresses the "relative image URLs require a repository" warning so the screenshot in README.md is accepted. `--allow-missing-repository` is kept defensively even though `repository` is set in package.json.

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

## 5. The `/kick` skill artifact

The single file in `resources/` (`kick.md`) is deployed to `~/.claude/commands/kick.md` on every activate. The copy is idempotent and unconditional — every activate overwrites the file with the bundled source. There is no version marker; the file is small enough that a fresh copy on activate is cheaper than tracking a version.

When editing `resources/kick.md`:
- Keep the inline `node -e` block byte-for-byte if you do not have a specific reason to change it. The block is what makes the post-compact summary extraction work; whitespace inside the heredoc is significant.
- Keep the file in English. The repo and the VS Code marketplace listing are English-first.
- After editing, `./install.ps1` and `Developer: Reload Window` is enough to pick up the new version on the developer machine. End users get the new version on the next VSIX install + reload.

Do not delete or rename `resources/kick.md` without updating `ensureKickSkill()` in `extension.js`.

---

## 6. Two READMEs must stay in sync

`README.md` (English) and `README_ru.md` (Russian) are the primary user-facing docs. Both are bundled inside the `.vsix` (see `.vscodeignore`).

Structural rules:
- Same section order in both files.
- Same screenshot at the top.
- A new "What's new in X.Y.Z" section gets added to **both**, not just one.
- When fixing a typo or factual error in one, mirror it in the other in the same commit.

Different prose tone is fine; different structure or different content is a drift bug.

---

## 7. Secrets and what never reaches the public repo

This repo is a **public** GitHub repository. Treat anything in the local working tree as potentially observable.

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

`claude-limit-web.png` (the README screenshot) is **not** secret and must be committed: both READMEs reference it.

---

## 8. Testing

There is no automated test suite. Verification is manual and consists of:

1. `./install.ps1` succeeds (`REMOVED=...`, `INSTALLED=...`, `REGISTRY_UPDATED=...`).
2. `Developer: Reload Window` in VS Code.
3. Open VS Code. Confirm:
   - Exactly one new status bar item appears: `$(pulse) limit`. No `cc-ctx`, no `🟢/⚪` dot.
   - Click `limit`. The Claude Quota panel opens. The 5h and 7d percentages render. The `/context` block fetches successfully when a workspace is open.
4. Open any Claude Code chat. Type `/kick`. A fenced markdown block appears in the chat with a Copy button at its top right.
5. Inspect `~/.claude/`:
   - `~/.claude/commands/kick.md` exists.
   - `~/.claude/scripts/kick-hook.js` does NOT exist (cleaned up if it was there).
   - `~/.claude/commands/kick-on.md` and `kick-off.md` do NOT exist.
   - `~/.claude/.kick-installed-version`, `.kick-disabled`, `.kick-log` do NOT exist.
   - `~/.claude/settings.json` is valid JSON and does not contain the string `kick-hook.js`.

If any of the above fails, do not package or release. Fix and reinstall first.

---

## 9. Tooling notes specific to this project

- **`vsce`** — invoked via `npx --yes @vscode/vsce package ...` so no global install is required. Run from the project root.
- **`install.ps1`** is Windows-only (PowerShell). The extension itself is cross-platform — only the local install helper depends on Windows paths. Linux/macOS users install via `code --install-extension <vsix>`.
- **No `node_modules`** are checked in or required at runtime. The extension uses only the VS Code API plus Node's built-in `fs`, `path`, `os`, and `child_process`. If you add a runtime dependency, also add a bundler step and revisit `.vscodeignore` — currently `node_modules/**` is excluded from the package.

---

## 10. Forbidden

1. Committing `.env`, `.secrets/`, or anything containing a real token / password / API key.
2. Pushing `.vsix` artifacts to the repo (use GitHub Releases instead).
3. Editing only one of `README.md` / `README_ru.md` for a user-visible change.
4. Re-introducing the v0.4.x PostCompact hook surface (`scripts/kick-hook.js`, `commands/kick-on.md`, `commands/kick-off.md`, `hooks.PostCompact` entry) without a documented platform-side fix from Anthropic that makes `systemMessage` render in VS Code.
5. Adding network calls beyond the two Anthropic OAuth endpoints already used. The extension is intentionally narrow; that is a stated guarantee in both READMEs.
