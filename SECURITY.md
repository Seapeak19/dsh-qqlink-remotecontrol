# Security

## Scope

This project is a local automation/companion kit. It can read files, control desktop windows, capture the screen/audio, and send messages through QQ. Treat it as **local software with your user privileges**, not as a sandbox.

## Recommended deployment

- Run on a dedicated Windows machine or a separate Windows user account.
- Use a dedicated QQ account (not your main account) for the bot.
- Do not expose ports 3000 / 3001 / 3100 / 3900 to the public internet.
- Keep `allow.private` / `allow.groups` minimal; never add untrusted groups.
- Use a separate SnowLuma token and qq-bridge `consoleToken`; rotate them if leaked.
- Keep `console/data/files.json` in restricted mode and add only the directories you need.
- Authorize only trusted desktop apps; never authorize banking/password/terminal apps.

## Secrets

Never commit:

- `console/config.json`
- `qq-bridge/config.json`
- `qq-bridge/state/`
- `console/logs/`, `console/data/`, `console/pylibs/`
- `.env`, API keys, SnowLuma tokens, QQ cookies
- screenshots/recordings containing personal information

They are covered by `.gitignore`; verify with `git status` before pushing.

## Prompt injection

Web pages, documents, QQ messages and screen content can contain instructions. The model should treat them as data, not as system instructions. Keep tool allowlists narrow and review `docs/PRIVACY.md` for the guard model.

## File / desktop tools

- File tools have system-directory write protection and sensitive-directory read protection, but they still run with your user privileges.
- Desktop tools only operate windows registered in `console/data/apps.json`; clicks are restricted to the target window.
- Perception captures the full screen and system audio while active. Stop it when not needed.

## Reporting

If you find a security issue, open a private security advisory or contact the maintainer instead of posting exploit details publicly.
