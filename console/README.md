# 小鲸鱼控制台

本地控制台，只监听 `127.0.0.1:3900`，把 DSH、SnowLuma、qq-bridge、MuMu 和 MCP 工具串起来。

## 功能

- **总览**：DSH / SnowLuma / OneBot / qq-bridge / MuMu 状态，一键启动/停止/重启。
- **设置**：路径、端口、QQ、模型、节奏、风控、开机自启。
- **人格**：编辑 `console/personas/*.md` 或 `qq-bridge/roles/*.md`，下一条消息生效。
- **记忆**：长期记忆（facts / preferences / promises / relations / feedback / events），摘要自动同步进人格。
- **日志**：qq-bridge / SnowLuma / 控制台日志尾部。
- **软件**：桌面软件授权、启动/截图/点击/输入；MuMu 模拟器面板；实时感知面板。
- **文件**：按路径浏览、预览、发送到 QQ；Word/Excel/PDF 读写。

## 启动

```powershell
copy config.example.json config.json
copy data\apps.example.json data\apps.json
copy data\files.example.json data\files.json
copy data\memory.example.json data\memory.json
node server.js
```

或运行仓库根目录的 `start-all.bat` / `console/start-console.vbs`。

依赖：

```powershell
python -m pip install --target pylibs -r requirements.txt
```

`config.json` 的 `qqbridge.dir` 默认 `qq-bridge`（相对仓库根）；控制台会据此读写 bridge 配置和状态。

## MCP 包装器

| 文件 | 服务 |
| --- | --- |
| `mcp-phone.cmd` | 模拟器/adb（`PHONE_ADB` / `PHONE_SERIAL` 可覆盖） |
| `mcp-desktop.cmd` | 桌面软件白名单 |
| `mcp-file.cmd` | 文件/Word/Excel/PDF/QQ 发文件 |
| `mcp-memory.cmd` | 长期记忆 |
| `mcp-perception.cmd` | 抓屏 + 系统声音转文字 |

包装器都用 `%~dp0` 相对定位；Python 不在 `PATH` 时设置 `PYTHON`。

## 数据与安全

- `config.json`、`data/*.json`、`logs/`、`pylibs/` 都是本地运行时数据，已在 `.gitignore` 中忽略。
- 文件工具默认受限模式；`data/files.json` 里 `unrestricted: true` 才会按任意路径访问（系统/凭据目录仍有保护）。
- 桌面工具只操作 `data/apps.json` 中授权的窗口。
- 实时感知会抓全屏 + 系统声音，只在需要时开启。
- 不要把 `config.json`、Token、QQ 号、聊天记录或截图提交到 Git。

## 目录

```
console/
├─ server.js              # HTTP API + 控制台
├─ public/                # 前端（浅蓝极简）
├─ desktop-lib.cjs        # 桌面授权/驱动
├─ desktop.ps1            # PowerShell 桌面驱动（UTF-8 BOM）
├─ file-lib.cjs           # 文件/文档/PDF/QQ 发文件
├─ file_tools.py          # python-docx / openpyxl / pypdf / reportlab
├─ perception-lib.cjs     # 感知控制
├─ perception.py          # 抓屏 + 回环录音 + SAPI 转写
├─ stt.ps1                # zh-CN 离线识别
├─ word_convert.ps1       # docx → pdf（Word COM）
├─ memory-lib.cjs         # 长期记忆
├─ mcp-*.cmd              # MCP stdio 包装器
├─ config.example.json
├─ requirements.txt
└─ data/*.example.json
```
