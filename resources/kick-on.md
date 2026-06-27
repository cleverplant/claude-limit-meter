---
description: Enable the PostCompact auto-handoff hook (kick auto)
allowed-tools: Bash
---

Enable the PostCompact auto-handoff hook by removing the disable marker.

Run exactly this command, no flags:

       rm -f "$HOME/.claude/.kick-disabled" 2>/dev/null; ls "$HOME/.claude/.kick-disabled" 2>/dev/null && echo "STATE=still-disabled" || echo "STATE=enabled"

After the command, report ONE concise line to the user in Russian:

- If output ends with `STATE=enabled`: report `✅ Kick auto-hook: ENABLED. PostCompact будет автоматически выдавать handoff в чат после каждого сжатия контекста.`
- If output ends with `STATE=still-disabled`: report `⚠️ Не удалось удалить marker-файл. Проверьте права на ~/.claude/.kick-disabled.`

Do not run any other tool. Do not summarize the hook design.
