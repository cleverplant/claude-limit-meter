---
description: Disable the PostCompact auto-handoff hook (kick auto)
allowed-tools: Bash
---

Disable the PostCompact auto-handoff hook by creating the disable marker.

Run exactly this command, no flags:

       touch "$HOME/.claude/.kick-disabled" && ls "$HOME/.claude/.kick-disabled" >/dev/null 2>&1 && echo "STATE=disabled" || echo "STATE=failed"

After the command, report ONE concise line to the user in Russian:

- If output ends with `STATE=disabled`: report `🔇 Kick auto-hook: DISABLED. PostCompact больше не будет автоматически выдавать handoff. Включить: /kick-on`
- If output ends with `STATE=failed`: report `⚠️ Не удалось создать marker-файл ~/.claude/.kick-disabled.`

Do not run any other tool. Do not summarize the hook design.
