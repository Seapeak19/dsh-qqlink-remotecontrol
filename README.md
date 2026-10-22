# 小鲸鱼 · AI Companion Kit

一个 **Windows 优先** 的本地 AI 陪伴/助手套件：把大模型接到 QQ、桌面软件、安卓模拟器、文件和持续视觉/听觉感知上，并提供一个本地控制台统一配置和启停。

> 这是整理后的公共版本：**不含任何个人账号、QQ 号、Token、聊天记录、截图或本机路径**。所有配置都通过 `*.example.json` 提供，运行前自行复制并填写。

## 功能

- **QQ 陪伴**：SnowLuma（OneBot v11）↔ `qq-bridge` ↔ DeepSeek Harness agent；支持私聊/群聊、引用、表情、表情包、等待/唤醒、长期记忆。
- **安卓模拟器**：MuMu + adb；截图、点按、滑动、输入中文、打开 App、连招。
- **桌面软件**：白名单授权后，启动/截图/点击/输入/按键/滚轮。
- **文件/文档**：Word、Excel、PDF、文本的读取/修改/拆分合并/加批注；QQ 发文件。
- **持续感知**：定时抓屏 + 系统回环录音 + Windows 自带 zh-CN 离线语音转文字，用于看视频/直播。
- **本地控制台**：总览、设置、人格、记忆、日志、软件、文件；浅蓝极简主题。
- **长期记忆**：事实/偏好/反馈/承诺/关系/事件，摘要自动注入人格。

## 架构

```
QQ 客户端
   │  OneBot v11
   ▼
SnowLuma (WebSocket 3001 / HTTP 3000)
   │
   ▼
qq-bridge (3100)  ──  DSH agent API
   │                      │
   │                      ├── mcp__phone__      MuMu / adb
   │                      ├── mcp__desktop__    授权桌面软件
   │                      ├── mcp__file__       Word/Excel/PDF/文本
   │                      ├── mcp__memory__     长期记忆
   │                      └── mcp__perception__ 抓屏 + 语音转写
   ▼
本地控制台 (3900)  ──  状态 / 配置 / 日志 / 人格 / 记忆 / 软件 / 文件
```

## 目录

```
.
├─ console/                 # 本地控制台 + 桌面/文件/感知库
│  ├─ server.js
│  ├─ public/               # 前端（浅蓝极简）
│  ├─ *.cjs / *.py / *.ps1
│  ├─ mcp-*.cmd             # MCP stdio 包装器（相对路径）
│  ├─ config.example.json
│  ├─ requirements.txt
│  └─ data/*.example.json
├─ packages/
│  ├─ phone-mcp/            # adb / 桌面 / 文件 / 记忆 / 感知 MCP
│  └─ companion/            # 早期 companion 核心（可选）
├─ qq-bridge/               # QQ ↔ DSH 桥接（独立 MIT 项目，已整合）
├─ roles/persona.example.md # 通用示例人格
├─ docs/                    # 架构、部署、MCP、隐私
└─ start-all.bat
```

## 环境要求

- Windows 10/11（桌面控制、MuMu、Word COM、系统语音识别均为 Windows 专用）
- Node.js **20+**（`qq-bridge` 建议 22.13+）
- Python **3.12+**（`python-docx` / `openpyxl` / `pypdf` / `reportlab` / `soundcard` / `Pillow`）
- 外部依赖（**不随仓库分发**）：
  - SnowLuma（单独安装并登录 QQ 小号）：QQ OneBot v11 网关；需要单独安装并登录 QQ 小号
  - DeepSeek Harness（DSH）：提供 agent API 与 MCP 宿主
  - MuMu Player 12（可选，安卓模拟器）
  - Microsoft Word（可选，用于 `docx_to_pdf` 的 COM 导出）

## 快速开始

```powershell
git clone <YOUR_REPO_URL> ai-companion-kit
cd ai-companion-kit

# 1) Node 依赖（根目录 + qq-bridge）
npm install
cd qq-bridge; npm install; cd ..

# 2) Python 依赖（建议装到 console/pylibs，代码会自动加入 sys.path）
python -m pip install --target console/pylibs -r console/requirements.txt

# 3) 配置
copy console\config.example.json console\config.json
copy qq-bridge\config.example.json qq-bridge\config.json
copy console\data\apps.example.json console\data\apps.json
copy console\data\files.example.json console\data\files.json
copy console\data\memory.example.json console\data\memory.json
copy roles\persona.example.md console\personas\persona.md

# 4) 启动 SnowLuma（单独）并登录 QQ 小号，然后启动控制台
start-all.bat
# 或：node console/server.js
```

打开 `http://127.0.0.1:3900`。

### 必填配置

`console/config.json`：

| 字段 | 说明 |
| --- | --- |
| `port` | 控制台端口，默认 3900 |
| `dsh.exe` | DSH 可执行文件路径（也可留空，用自动发现端口） |
| `snowluma.dir` | SnowLuma 安装目录 |
| `qqbridge.dir` | qq-bridge 目录，默认 `qq-bridge`（相对仓库根） |
| `mumu.manager` / `mumu.adb` | MuMu 管理器和 adb 路径（可选） |
| `mumu.serial` | adb 序列号，默认 `127.0.0.1:16384` |
| `autoStart` | 控制台启动时是否自动拉起外部程序；公共版默认 `false` |

`qq-bridge/config.json`：

| 字段 | 说明 |
| --- | --- |
| `ownerQQ` | **主人 QQ 号**（必须填；决定私聊白名单和主动消息目标） |
| `allow.private` | 允许私聊的 QQ 号数组，例如 `[123456789]` |
| `allow.groups` | 允许的群号数组；不需要群聊就留空 |
| `snowluma.accessToken` | SnowLuma 的访问 Token |
| `snowluma.wsUrl` / `httpUrl` | 默认 `ws://127.0.0.1:3001` / `http://127.0.0.1:3000` |
| `dsh.baseUrl` | DSH API 地址；控制台会自动发现并回写 |
| `consoleToken` | qq-bridge 控制台(3100)令牌，建议随机生成 |

复制后把 `roles/persona.example.md` 改成自己的人设，或复制多份到 `qq-bridge/roles/`。

## 接入 DSH MCP

DSH profile 需要挂载以下 MCP stdio 服务（示例见 [docs/DSH-MCP.md](docs/DSH-MCP.md)）：

- `mcp-phone` → `console/mcp-phone.cmd`
- `mcp-memory` → `console/mcp-memory.cmd`
- `mcp-desktop` → `console/mcp-desktop.cmd`
- `mcp-file` → `console/mcp-file.cmd`
- `mcp-perception` → `console/mcp-perception.cmd`

包装器都用 `%~dp0` 相对定位，克隆到任意目录都能用；需要时通过环境变量覆盖 `PHONE_ADB` / `PHONE_SERIAL` / `PYTHON` / `QQ_BRIDGE_DIR`。

## 安全与隐私

- 仓库里**没有** `config.json`、`state/`、`logs/`、`data/`、Token、QQ 号、聊天记录、截图。
- 文件工具默认 **受限模式**：只访问 `console/data/files.json` 里的 roots；要开放任意路径需显式设置 `"unrestricted": true`，系统目录和凭据目录仍有写/读保护。
- 桌面向导只操作 `console/data/apps.json` 里授权的窗口；不提供任意 exe 入口。
- QQ 工具只对 `allow.private` / `allow.groups` 白名单开放；不要把群随便加进去。
- 运行前阅读 [SECURITY.md](SECURITY.md) 和 [docs/PRIVACY.md](docs/PRIVACY.md)。
- 本项目的工具具有本机文件/桌面/录音能力，请只在自己的机器、自己负责的账号上使用。

## 已知限制

- 桌面控制依赖 Windows PowerShell 5.1；`desktop.ps1` 必须保存为 **UTF-8 with BOM**。
- PDF 的「原样改正文」不支持；只能读文字、拆合/旋转、加中文批注，或 `pdf_to_docx` 提取文字（不保留排版）后再 `docx_to_pdf`。
- 持续感知是「抽帧 + 语音转文字」，**不是逐帧视频理解**；建议只在使用时开启。
- Windows 自带语音识别对中文口语有误差，不能保证逐字正确。
- B站自动刷任务已移除；需要时在模拟器/客户端里手动打开。
- Word COM 的 `docx_to_pdf` 在部分 Office 安装/文件锁定时可能失败，失败会在工具返回里说明。

## 第三方与许可

- 本仓库：MIT，见 [LICENSE](LICENSE)。
- `qq-bridge/`：独立 MIT 项目，保留其 [LICENSE](qq-bridge/LICENSE) 与 README。
- SnowLuma、DeepSeek Harness、MuMu 为各自作者的作品，不随本仓库分发；使用前请遵守其许可与平台规则。
- 本项目与腾讯/QQ、字节跳动/抖音、B站、金山/WPS、微软等公司无隶属关系。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SETUP.md](docs/SETUP.md)
- [docs/DSH-MCP.md](docs/DSH-MCP.md)
- [docs/PRIVACY.md](docs/PRIVACY.md)
- [SECURITY.md](SECURITY.md)
- [console/README.md](console/README.md)

## 免责声明

本项目仅供个人学习、研究与自托管使用。自动化操作可能违反第三方平台的服务条款；请自行评估风险，不要用于骚扰、刷量、诈骗、绕过风控或其他违法用途。
