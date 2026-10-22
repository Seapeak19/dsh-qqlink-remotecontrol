# DSH MCP profile

The bridge expects these MCP servers in the DSH profile used by `qq-bridge` (typically `~/.dsh/profiles/desktop/cordis.patch.yml`). Replace `<REPO>` with the absolute path to this repository and `<USER>` with your Windows user name **only if** your DSH config requires absolute paths.

```yaml
- insert:
    - id: mcp-phone
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: phone
        transport: stdio
        command: 'C:\Windows\System32\cmd.exe'
        args: ['/c', '<REPO>\console\mcp-phone.cmd']
        toolCallTimeoutMs: 120000

    - id: mcp-memory
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: memory
        transport: stdio
        command: 'C:\Windows\System32\cmd.exe'
        args: ['/c', '<REPO>\console\mcp-memory.cmd']
        toolCallTimeoutMs: 120000

    - id: mcp-desktop
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: desktop
        transport: stdio
        command: 'C:\Windows\System32\cmd.exe'
        args: ['/c', '<REPO>\console\mcp-desktop.cmd']
        toolCallTimeoutMs: 120000

    - id: mcp-file
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: file
        transport: stdio
        command: 'C:\Windows\System32\cmd.exe'
        args: ['/c', '<REPO>\console\mcp-file.cmd']
        toolCallTimeoutMs: 120000

    - id: mcp-perception
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: perception
        transport: stdio
        command: 'C:\Windows\System32\cmd.exe'
        args: ['/c', '<REPO>\console\mcp-perception.cmd']
        toolCallTimeoutMs: 120000
```

Notes:

- The MCP tool prefixes are `mcp__phone__`, `mcp__memory__`, `mcp__desktop__`, `mcp__file__`, `mcp__perception__`. The QQ guard in `qq-bridge/plugins/qq-agent-presets/` must allow exactly these prefixes.
- `mcp-phone.cmd` connects adb before starting; override `PHONE_ADB` / `PHONE_SERIAL` if your emulator differs.
- `mcp-file.cmd` / `mcp-perception.cmd` start Python; set `PYTHON` if `python` is not on `PATH`.
- `console/config.json`'s `qqbridge.dir` points the console at `qq-bridge`; the bridge itself reads its own `config.json`.
- After changing the profile, DSH must reload it (restart DSH or the MCP client). Existing QQ sessions cache the old tool list; reset the session after profile changes.
