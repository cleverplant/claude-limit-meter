# Uninstall prompt — VSIX only, keep the hook (Option A)

Copy-ready prompt for **Codex** or **Claude Code** that removes the
Claude Limit Meter VS Code extension **but leaves the `/kick auto`
PostCompact hook intact** in `~/.claude/`. After this:

- the `cc-ctx` status bar indicator and `🟢/⚪` kick dot disappear;
- the hook keeps firing on every `/compact` in Claude Code;
- the slash commands `/kick`, `/kick-on`, `/kick-off` keep working;
- `~/.claude/.kick-log` keeps recording fires.

Equivalent to running:

1. `Extensions → Claude Limit Meter → Uninstall`
2. `Developer: Reload Window`

The agent **cannot trigger step 2** from outside VS Code — you press
the keys yourself after the agent finishes.

Paste the block below into a Codex or Claude Code session.

---

```
Задача: удалить ТОЛЬКО VS Code-часть расширения Claude Limit Meter
(`local.claude-limit-meter`). PostCompact-хук `/kick auto`, развёрнутый
в `~/.claude/`, ОСТАВИТЬ — он должен продолжать работать в Claude Code
после удаления расширения.

Хост: Windows. Все пути — от `$env:USERPROFILE`.

Чего ты сделать НЕ можешь:
- вызвать `Developer: Reload Window` — отдашь пользователю в финале.

Шаги (строго по порядку):

1. Pre-flight. Должна существовать хотя бы одна папка
   `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`.
   Если нет — расширение уже не установлено, прервись и сообщи.

2. НИЧЕГО в `~/.claude/` не трогать (главное отличие от полного
   удаления):
   - `~/.claude/settings.json` — оставить как есть;
   - `~/.claude/scripts/kick-hook.js` — оставить;
   - `~/.claude/commands/kick.md|kick-on.md|kick-off.md` — оставить;
   - `~/.claude/.kick-installed-version|.kick-disabled|.kick-log` —
     оставить.
   Если случайно отредактировал — откат.

3. Удалить установленные папки расширения:
   - все `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
     → `Remove-Item -Recurse -Force`.

4. Поправить `$env:USERPROFILE\.vscode\extensions\extensions.json`:
   - прочитай JSON-массив;
   - удали ВСЕ элементы с `identifier.id == "local.claude-limit-meter"`
     или с `relativeLocation`, начинающимся на `local.claude-limit-meter-`;
   - запиши обратно атомарно.

5. Verification:
   - папок `local.claude-limit-meter-*` больше нет;
   - `extensions.json` не содержит `local.claude-limit-meter`;
   - `~/.claude/scripts/kick-hook.js` ВСЁ ЕЩЁ существует;
   - `~/.claude/settings.json` ВСЁ ЕЩЁ содержит entry с `kick-hook.js`
     в `hooks.PostCompact`.

6. Финальный отчёт:
   - что удалено;
   - явная строка: «Status bar исчезнет после Ctrl+Shift+P →
     Developer: Reload Window (это ты делаешь сам). Хук /kick auto
     продолжает работать — проверь в любом чате Claude Code командами
     /kick, /kick-on, /kick-off, а после /compact в чате должен
     появиться блок `🔄 /kick auto (PostCompact) — handoff готов:`.»

Запрещено:
- трогать `~/.claude/`;
- удалять чужие записи из `extensions.json`.
```
