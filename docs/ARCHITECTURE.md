# Architecture

## Components

| Component | Role |
| --- | --- |
| `qq-bridge` | OneBot v11 ↔ DSH agent bridge; sessions, wake, tools, guards, QQ console (3100) |
| `console` | Local dashboard (3900): status, start/stop, config, persona, memory, logs, apps, files |
| `packages/phone-mcp` | MCP tools: phone/adb, desktop, memory, file/document/PDF, perception |
| `packages/companion` | Optional early companion core (brain, diary, humanize, wake) |
| SnowLuma | External OneBot v11 gateway (QQ login, WS 3001 / HTTP 3000) |
| DSH | External DeepSeek Harness agent host + MCP client |
| MuMu | External Android emulator (optional) |

## Data flow

1. A QQ message arrives at SnowLuma.
2. SnowLuma forwards it over WebSocket to `qq-bridge`.
3. `qq-bridge` builds a prompt (persona + recent messages + wake rules) and calls the DSH agent API.
4. DSH runs the model with MCP tools. Tool calls go to `console/mcp-*.cmd` → Node MCP servers.
5. The agent sends replies through bridge tools (`qq_send_message`, `qq_reply`, …); SnowLuma delivers them to QQ.
6. The console reads bridge/DSH status and writes configuration; it can also launch/stop the bridge.

## State

| Path | Contents |
| --- | --- |
| `qq-bridge/state/` | sessions, social-v2, wake state, logs (runtime, ignored) |
| `qq-bridge/roles/` | persona cards (`*.md`; examples tracked) |
| `console/data/` | apps, files, memory, perception state (runtime, ignored) |
| `console/logs/` | console/bridge/snowluma logs (ignored) |

## Tool surfaces

- `mcp__phone__*` — emulator/adb: screenshot, tap, swipe, text, apps, macros.
- `mcp__desktop__*` — authorized desktop windows only; snapshot/click/type/key/scroll.
- `mcp__file__*` — text/Word/Excel/PDF read-write and QQ file sending.
- `mcp__memory__*` — long-term memory CRUD.
- `mcp__perception__*` — rolling screen frames + system-audio speech-to-text.
- `mcp__snowluma__*` — QQ send/wait/wake/sticker/slang/feedback tools (via qq-bridge).
- `mcp__web-search-safe__*` — read-only web search/fetch with SSRF protection.

## Guards

`qq-bridge/plugins/qq-agent-presets/qq-tool-restrict-*.mjs` limits which tool prefixes the QQ agent may call. Keep the latest guard file referenced by `presets/qq-chat-v2.patch.yml`; if you edit a guard, create a new module filename and repoint the preset (ESM modules are cached).
