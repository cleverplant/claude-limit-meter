# Uninstall prompt — full removal (Option B)

Copy-ready prompt for **Codex** or **Claude Code** that fully removes the
Claude Limit Meter VS Code extension **and** every artifact it deployed
into `~/.claude/` (the `/kick auto` PostCompact hook, slash commands,
markers, log, and the `hooks.PostCompact` entry inside
`~/.claude/settings.json`).

Equivalent to running, in order:

1. Command Palette → `Claude Limit Meter: Uninstall Kick Hook`
2. `Extensions → Claude Limit Meter → Uninstall`
3. `Developer: Reload Window`

The agent **cannot trigger step 3** from outside VS Code — you press
the keys yourself after the agent finishes. The agent also cannot call
Command Palette commands from outside the VS Code process; it
replicates the effect of `Claude Limit Meter: Uninstall Kick Hook` via
direct `fs` + JSON operations instead.

Paste the block below into a Codex or Claude Code session. The prompt
is written in Russian — the agent's action plan is language-agnostic.

---

```
Задача: полностью удалить расширение Claude Limit Meter
(`local.claude-limit-meter`) и все следы PostCompact-хука `/kick auto`,
который оно развернуло в `~/.claude/`.

Хост: Windows. Все пути — от `$env:USERPROFILE`.

Чего ты сделать НЕ можешь (отдашь пользователю в финале):
- вызвать `Developer: Reload Window` в VS Code (нет внешнего API);
- вызвать команду `Claude Limit Meter: Uninstall Kick Hook` через
  Command Palette (привязана к процессу VS Code). Поэтому
  воспроизводишь её эффект напрямую через fs.

Шаги (строго по порядку, не пропускать verification):

1. Pre-flight. Если ни одного из путей нет — расширение уже не
   установлено, прервись и сообщи:
   - `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
   - `$env:USERPROFILE\.claude\scripts\kick-hook.js`
   - `$env:USERPROFILE\.claude\.kick-installed-version`

2. Снять hook-запись из `~/.claude/settings.json` (САМОЕ ОПАСНОЕ место):
   - прочитай JSON;
   - в `hooks.PostCompact` найди и удали ВСЕ элементы, у которых хотя бы
     один внутренний hook имеет `command`, содержащий подстроку
     `kick-hook.js`;
   - если массив `PostCompact` стал пустым — удали ключ `PostCompact`;
   - если объект `hooks` стал пустым — удали ключ `hooks`;
   - ВСЕ остальные ключи (`permissions`, `model`, `env`, `mcpServers`,
     `apiKeyHelper`, любые кастомные) — НЕ ТРОГАТЬ;
   - сохрани атомарно (через временный файл + rename).

3. Удалить файлы хука:
   - `~/.claude/scripts/kick-hook.js`
   - `~/.claude/commands/kick.md`
   - `~/.claude/commands/kick-on.md`
   - `~/.claude/commands/kick-off.md`
   - `~/.claude/.kick-installed-version`
   - `~/.claude/.kick-disabled` (если есть)
   - `~/.claude/.kick-log` (если есть)
   Папки `scripts/` и `commands/` НЕ удалять — там могут лежать чужие
   скрипты и слэш-команды Claude Code.

4. Удалить установленные папки расширения целиком:
   - все `$env:USERPROFILE\.vscode\extensions\local.claude-limit-meter-*`
     → `Remove-Item -Recurse -Force`.

5. Поправить `$env:USERPROFILE\.vscode\extensions\extensions.json`
   (если файл есть):
   - прочитай JSON-массив;
   - удали ВСЕ элементы с `identifier.id == "local.claude-limit-meter"`
     или с `relativeLocation`, начинающимся на `local.claude-limit-meter-`;
   - запиши обратно атомарно.

6. Verification:
   - `Test-Path` для всех путей из шагов 3 и 4 → `False`;
   - `~/.claude/settings.json` парсится как валидный JSON и не содержит
     подстроку `kick-hook.js`;
   - `extensions.json` не содержит `local.claude-limit-meter`.
   Если что-то из этого упало — откатывайся НЕ через сохранённый
   backup `settings.json`, а сообщи пользователю что сломалось.

7. Финальный отчёт:
   - короткий список того, что удалено;
   - явная строка: «Чтобы VS Code забыл расширение окончательно —
     Ctrl+Shift+P → Developer: Reload Window. Это ты делаешь сам.»

Запрещено:
- удалять `~/.claude/` или `~/.vscode/extensions/` целиком;
- редактировать `settings.json` без атомарной записи;
- пропускать verification.
```
