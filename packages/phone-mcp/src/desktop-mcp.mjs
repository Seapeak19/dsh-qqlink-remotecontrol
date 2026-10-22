// desktop-mcp · Windows 应用控制 MCP 服务器（stdio）
//
// 只允许操作控制台「应用」页授权的软件（console/data/apps.json）。
// 工具：列应用 / 启动 / 列窗口 / 截图 / 点击 / 输入 / 按键 / 滚轮 / 聚焦。
//
// 复用 phone-mcp 的 node_modules（@modelcontextprotocol/sdk、zod）。
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import desktopLib from '../../../console/desktop-lib.cjs';

const server = new McpServer({ name: 'desktop-mcp', version: '1.0.0' });
const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ content: [{ type: 'text', text: String(s) }], isError: true });

const appParam = z.string().describe('应用 id，用 desktop_list_apps 查看；只能是控制台已授权的应用');

const KEYMAP = {
  enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}',
  backspace: '{BACKSPACE}', delete: '{DELETE}', up: '{UP}', down: '{DOWN}',
  left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}',
  pageup: '{PGUP}', pagedown: '{PGDN}', space: ' ',
  'ctrl+s': '^s', 'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v',
  'ctrl+x': '^x', 'ctrl+z': '^z', 'ctrl+f': '^f', 'alt+f4': '%{F4}', f5: '{F5}',
};

function toSendKeys(key) {
  const k = String(key || '').trim();
  const out = KEYMAP[k.toLowerCase()] || k;
  if (!out || out.length > 60 || !/^[\x20-\x7E{}^%~+()]+$/.test(out)) {
    throw new Error('不支持的按键：' + k);
  }
  return out;
}

function appAction(appId, action) {
  return desktopLib.requireApp(appId, action);
}

async function runOn(app, action, params = {}, timeout = 30000) {
  const r = await desktopLib.runDesktop(action, {
    process: app.process,
    titlePattern: app.titlePattern,
    ...params,
  }, timeout);
  if (!r.ok) throw new Error(r.error || '操作失败');
  return r;
}

server.tool(
  'desktop_list_apps',
  '列出控制台已授权的电脑软件，以及它们当前是否在运行。操作电脑软件前先调用这个，拿到 app id。',
  {},
  async () => {
    const apps = desktopLib.listApps();
    if (!apps.length) return text('还没有授权任何应用。请让用户在控制台「应用」页添加。');
    let running = [];
    try { running = await desktopLib.listRunning(); } catch {}
    const lines = apps.map((a) => {
      if (a.screen) {
        return `- ${a.id} | ${a.name} | 整屏截图 | ${a.enabled ? '已启用' : '已停用'} | 允许动作：${a.allow.join(', ')}`;
      }
      let hit = null;
      try {
        hit = running.find((r) => r.process && r.process.toLowerCase() === a.process.toLowerCase()
          && (!a.titlePattern || new RegExp(a.titlePattern, 'i').test(r.title || '')));
      } catch {}
      return `- ${a.id} | ${a.name} | 进程 ${a.process} | ${a.enabled ? '已启用' : '已停用'} | ${hit ? '运行中：' + hit.title : '未启动'} | 允许动作：${a.allow.join(', ')}`;
    });
    return text(`已授权 ${apps.length} 个应用：\n${lines.join('\n')}`);
  }
);

server.tool(
  'desktop_launch',
  '启动一个已授权的电脑软件。只用于控制台「应用」页里存在的 app。',
  { app: appParam },
  async ({ app }) => {
    try {
      const a = appAction(app, 'launch');
      const r = await desktopLib.launch(a);
      return r.ok ? text(`已启动「${a.name}」${r.window ? '，窗口：' + r.window.title : ''}`) : fail(r.error || '启动失败');
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_windows',
  '列出某个已授权软件当前的窗口（pid / 标题）。',
  { app: appParam },
  async ({ app }) => {
    try {
      const a = appAction(app, 'windows');
      const r = await runOn(a, 'windows');
      const list = r.windows || [];
      if (!list.length) return text(`「${a.name}」当前没有窗口，先 desktop_launch。`);
      return text(list.map((w) => `- pid ${w.pid} | ${w.title}`).join('\n'));
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_snapshot',
  '截取一个已授权软件当前窗口的画面，直接返回图片，用来“看”软件界面。app 传 desktop 可截整屏（包括桌面和所有窗口，需控制台已授权「桌面（整屏）」）。坐标以截图为基准，从窗口左上角算。',
  { app: appParam },
  async ({ app }) => {
    try {
      const a = appAction(app, 'snapshot');
      const r = a.screen ? await desktopLib.screenSnapshot() : await desktopLib.snapshot(a);
      if (!r.ok) return fail(r.error || '截图失败');
      const imgPath = (r.jpg && fs.existsSync(r.jpg)) ? r.jpg : r.path;
      const b64 = fs.readFileSync(imgPath).toString('base64');
      const mimeType = /\.jpe?g$/i.test(imgPath) ? 'image/jpeg' : 'image/png';
      const label = a.screen
        ? `整屏 ${r.width}x${r.height}`
        : `「${a.name}」窗口 ${r.window?.width}x${r.window?.height}，标题：${r.window?.title || ''}`;
      return {
        content: [
          { type: 'text', text: label },
          { type: 'image', data: b64, mimeType },
        ],
      };
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_click',
  '在一个已授权软件的窗口内点击。x/y 是相对于窗口左上角的像素坐标（先 desktop_snapshot 看位置）。只能点授权窗口内。',
  {
    app: appParam,
    x: z.number().int().min(0).describe('相对窗口左上角的 x'),
    y: z.number().int().min(0).describe('相对窗口左上角的 y'),
    double: z.boolean().optional().describe('是否双击，默认 false'),
  },
  async ({ app, x, y, double }) => {
    try {
      const a = appAction(app, 'click');
      const r = await runOn(a, 'click', { x, y, double: !!double });
      return text(`已点击「${a.name}」窗口 (${x}, ${y})${double ? ' 双击' : ''}${r.focused ? '' : '（窗口未能切前台，可能没生效）'}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_type',
  '向一个已授权软件的当前输入框输入文字（支持中文，走剪贴板粘贴）。先点一下输入框再调用。',
  {
    app: appParam,
    text: z.string().min(1).max(2000).describe('要输入的文字'),
  },
  async ({ app, text: content }) => {
    try {
      const a = appAction(app, 'type');
      const r = await runOn(a, 'type', { text: content }, 20000);
      return text(`已向「${a.name}」输入 ${r.chars ?? content.length} 个字符`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_key',
  '向一个已授权软件发送按键，例如 enter / tab / esc / ctrl+s / ctrl+a / alt+f4 / f5 / up / down。',
  {
    app: appParam,
    key: z.string().min(1).describe('按键，例如 enter、ctrl+s'),
  },
  async ({ app, key }) => {
    try {
      const a = appAction(app, 'key');
      const keys = toSendKeys(key);
      await runOn(a, 'key', { keys }, 15000);
      return text(`已向「${a.name}」发送按键 ${key}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_scroll',
  '在一个已授权软件窗口内滚动滚轮。delta 正数向上、负数向下（120 为一格）。',
  {
    app: appParam,
    delta: z.number().int().min(-1200).max(1200).default(120).describe('滚动量，正上负下'),
  },
  async ({ app, delta }) => {
    try {
      const a = appAction(app, 'scroll');
      await runOn(a, 'scroll', { delta }, 15000);
      return text(`已滚动「${a.name}」${delta > 0 ? '向上' : '向下'} ${Math.abs(delta) / 120} 格`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'desktop_focus',
  '把一个已授权软件的窗口切到前台。',
  { app: appParam },
  async ({ app }) => {
    try {
      const a = appAction(app, 'focus');
      const r = await runOn(a, 'focus', {}, 15000);
      return text(`已切到「${a.name}」${r.focused ? '' : '（没能抢到前台）'}`);
    } catch (e) { return fail(e.message); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[desktop-mcp] ready · ' + desktopLib.APPS_FILE);