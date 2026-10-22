# Privacy

## What is not in this repository

This public tree is a sanitized copy. The following are intentionally excluded:

- `console/config.json`, `qq-bridge/config.json` (local paths, tokens, owner QQ)
- `qq-bridge/state/`, `console/data/`, `console/logs/`, `console/pylibs/`
- QQ numbers, account names, B站/抖音 account names, SnowLuma tokens
- chat transcripts, memory entries, persona memories
- screenshots, recordings, documents, test media
- local installation paths (`C:\Users\<name>`, `D:\...`)

## Data flows

- QQ messages pass through SnowLuma and `qq-bridge`; they are stored in `qq-bridge/state/` at runtime.
- Screenshots/audio for continuous perception are written to `console/data/perception/` and are local-only.
- File tools read/write the paths you authorize; Word/Excel/PDF content is processed locally.
- Long-term memory is stored in `console/data/memory.json`; by default it is local-only.

## Before publishing your own fork

```powershell
git status
git grep -n -I -E "1[0-9]{9}|@|token|secret|api[_-]?key|C:\\\\Users\\\\|D:\\\\" -- . ":(exclude)node_modules"
```

Check:

1. no `config.json` / `.env` / state / logs / data;
2. no screenshots or personal documents;
3. no persona file containing real names, school, workplace, health, relationships or account IDs;
4. no tokens in commit history (if a secret was ever committed, rotate it and rewrite history).

## Runtime hygiene

- Keep `console/data/files.json` restricted and review roots regularly.
- Stop continuous perception when not needed; it captures the full screen and system audio.
- Delete `console/logs/`, `qq-bridge/state/` and `console/data/perception/` before sharing a machine or a backup.
- Rotate SnowLuma `accessToken` and qq-bridge `consoleToken` if they may have leaked.
