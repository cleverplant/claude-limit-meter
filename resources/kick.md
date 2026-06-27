---
description: Generate a chat handoff prompt before context limit (paste into new chat)
allowed-tools: Bash, Read, Edit, Grep, Glob
---

The user is approaching the context limit (typically the 91% auto-compact warning) and wants to move to a fresh chat without losing orientation. Generate a complete, copy-ready handoff message they will paste into a new Claude Code session.

## Hard rules

- Do NOT create any new files in the project. No `session-recovery-*.md`, no notes, no logs. The user explicitly forbids this — it is "junk in the project".
- Updating `plans/plan.md` IS allowed because it is a living document per `PLANS.md`. Only update if the project has one.
- Do NOT run `git commit`, `git push`, or any destructive command. The user controls commits.
- Keep the final chat output focused on the handoff message itself. No long preamble.

## Steps

1. Snapshot project state. Run in parallel:
   - `git status --short --branch`
   - `git log --oneline -5`
   - `git diff --stat HEAD` (to see what changed in this session that isn't yet committed)

2. Identify the stage. Read `plans/plan.md` if it exists. Extract:
   - The current focus / stage name (look for "Current Focus", "Текущий фокус", or the most recent `[x]` entries in the `Progress` section).
   - The nearest next concrete step (next unchecked `[ ]` or the next narrative milestone after the last `[x]`).
   - If there is no `plans/plan.md`, fall back to recent commit messages and any open TODO files.

3. Summarize this session honestly. Base bullets ONLY on what actually happened in the current conversation: files edited, commits made, decisions taken, blockers hit. Do not invent work. If nothing substantive happened, say so.

4. Update `plans/plan.md` Progress section (only if it exists AND something substantive was accomplished this session). Append ONE line in the project's existing format. Common format:

       - [x] (YYYY-MM-DD HH:MM+TZ) <one-sentence summary of what this session accomplished>

   Match the timestamp format already used in that file. If unsure, use ISO `YYYY-MM-DDTHH:MMZ`.

5. Output the handoff message as a fenced code block so the user can copy it in one click. Use this template, filling in real values. Write it in the language used in this conversation (Russian if the user has been writing in Russian, otherwise English):

       Read CLAUDE.md, plans/plan.md, and any relevant stage doc in plans/.

       We are at: <stage name>.

       What was done in the previous chat:
       - <bullet 1>
       - <bullet 2>
       - <bullet 3>

       Continue from: <next concrete step>.

       Constraints:
       - Do not widen architecture beyond the task.
       - Do not start large refactors without explicit request.
       - Destructive git commands (push, reset --hard, rm) require explicit approval per CLAUDE.md §17.2.

       Current git state: branch <branch>, <clean|dirty>, last commit <hash> <subject>.

6. After the code block, report ONE short line: what was added to `plan.md` (if anything) and "Откройте новый чат и вставьте промпт выше." (or the English equivalent).

## Post-compact summary extraction

Recommended flow for the user: run `/compact` FIRST, then `/kick`. After `/compact`, the JSONL contains a structured English summary written by Claude for re-consumption. `/kick` should extract it and offer it as a second, deeper-context block.

How to extract — pick the JSONL of the CURRENT session only. Heuristic: the active session's JSONL is the one being written to right now. Filter by mtime AND by freshness of the compact entry itself, to avoid pulling summaries from a sibling chat window or from an old session left in the same project directory:

       node -e "
       const fs = require('fs');
       const path = require('path');
       const encoded = process.cwd().replace(/[\\\\\\/:]/g,'-');
       const dir = path.join(process.env.USERPROFILE || process.env.HOME, '.claude', 'projects', encoded);
       if (!fs.existsSync(dir)) { console.log('NO_JSONL dir=' + dir); process.exit(0); }
       const now = Date.now();
       const files = fs.readdirSync(dir).filter(f=>f.endsWith('.jsonl'))
         .map(f=>({f, m: fs.statSync(path.join(dir,f)).mtimeMs}))
         .sort((a,b)=>b.m-a.m);
       if (!files.length) { console.log('NO_JSONL'); process.exit(0); }
       const recent = files.filter(x => now - x.m < 30000);
       if (recent.length > 1) console.error('WARN: multiple active JSONLs in this project: ' + recent.map(x=>x.f).join(', '));
       const lines = fs.readFileSync(path.join(dir, files[0].f),'utf8').split('\n').filter(Boolean);
       let last = null;
       for (const ln of lines) {
         try {
           const o = JSON.parse(ln);
           if (o.isCompactSummary && o.message) {
             const ts = o.timestamp ? Date.parse(o.timestamp) : null;
             const c = o.message.content;
             const text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(p=>p.text||'').join('\n') : JSON.stringify(c));
             last = { text, ts };
           }
         } catch(e){}
       }
       if (!last) { console.log('NO_SUMMARY'); process.exit(0); }
       const ageMin = last.ts ? Math.round((now - last.ts) / 60000) : null;
       console.log('AGE_MIN=' + (ageMin === null ? 'unknown' : ageMin));
       console.log('---SUMMARY---');
       console.log(last.text);
       "

Interpretation:

- `NO_JSONL` — no session files at all in this project's directory. Skip the summary block entirely.
- `NO_SUMMARY` — current session's JSONL has no `isCompactSummary` entry. Tell the user: "Post-compact summary в текущей сессии не найден. Для глубокого контекста: сначала `/compact`, потом `/kick`."
- Output starts with `AGE_MIN=<N>` then `---SUMMARY---` then summary text — extract the summary text (everything after `---SUMMARY---`) and embed it AS-IS in a second fenced code block after the handoff message. Heading must include the age, e.g.: `Полный контекст (post-compact summary, возраст: 14 мин — решайте сами, актуален ли):`. If `AGE_MIN=unknown`, omit the age but still embed.
- `WARN: multiple active JSONLs` on stderr — surface to the user: "Внимание: в этом проекте открыто >1 окна Claude Code. Я взял самое свежее, но убедитесь, что это нужная сессия."

Do not edit the summary. Do not paraphrase. Do not truncate unless it exceeds ~30K characters; in that case, keep the first and last halves and put `[...truncated...]` in the middle.
