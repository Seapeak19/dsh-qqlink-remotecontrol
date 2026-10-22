# Setup

## 1. Prerequisites

- Windows 10/11
- Node.js 20+ (22.13+ recommended for `qq-bridge`)
- Python 3.12+
- Git
- Optional: SnowLuma, DeepSeek Harness, MuMu Player 12, Microsoft Word

## 2. Node dependencies

```powershell
npm install
cd qq-bridge
npm install
cd ..
```

## 3. Python dependencies

Recommended (keeps the repo self-contained):

```powershell
python -m pip install --target console/pylibs -r console/requirements.txt
```

If your Python is not on `PATH`, set `PYTHON` to its full path before starting the MCP servers.

## 4. Configuration

```powershell
copy console\config.example.json console\config.json
copy qq-bridge\config.example.json qq-bridge\config.json
```

Edit:

- `console/config.json`: DSH/SnowLuma/MuMu paths, `qqbridge.dir` (default `qq-bridge`).
- `qq-bridge/config.json`: `ownerQQ`, `allow.private`, SnowLuma `accessToken`, `consoleToken`, `dsh.baseUrl`.

Generate a random console token, e.g.:

```powershell
-join ((48..57) + (97..102) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
```

## 5. Data files

```powershell
copy console\data\apps.example.json console\data\apps.json
copy console\data\files.example.json console\data\files.json
copy console\data\memory.example.json console\data\memory.json
copy roles\persona.example.md console\personas\persona.md
```

- `apps.json`: desktop apps you authorize. Add only trusted apps.
- `files.json`: allowed file roots. Default is restricted; set `"unrestricted": true` only if you understand the risk.
- `memory.json`: starts empty.
- Persona: edit `persona.md`; do not put passwords or sensitive data in it.

## 6. DSH MCP profile

See [DSH-MCP.md](DSH-MCP.md). The five stdio servers must be mounted in the DSH profile used by the bridge.

## 7. Start

1. Start SnowLuma and log in the QQ bot account.
2. Start DSH (or let the console discover/launch it).
3. Start the bridge: `cd qq-bridge; npm start` (or via the console).
4. Start the console: `node console/server.js` (or `start-all.bat`).
5. Open `http://127.0.0.1:3900`.

## 8. Verify

- Console overview shows DSH/SnowLuma/OneBot/qq-bridge green.
- Send a QQ private message from `ownerQQ`: it should reply.
- Try “打开记事本，截图给我看看” (Notepad authorized) → desktop tool.
- Try “列出授权文件夹” → file tool.
- Start “实时感知” for a few seconds → latest frame + transcript.

## Troubleshooting

- **`tool input is invalid JSON`**: the model emitted invalid tool-call JSON; `qq_send_message.messages` is array-only now. Restart the bridge and reset the session.
- **QQ no response**: check SnowLuma ports 3000/3001, bridge 3100, DSH port; see `qq-bridge/state/bridge.log`.
- **Desktop launch timeout**: some Electron apps need an Explorer launch fallback; `desktop.ps1` tries it automatically. If the app itself is broken, the error reports the exit code.
- **File save fails**: close Word/Excel/WPS first; the file may be locked.
- **PDF text extraction empty**: scanned PDFs need OCR; this project does not bundle OCR.
