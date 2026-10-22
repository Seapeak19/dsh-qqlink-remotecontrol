// perception-mcp · 持续视觉+听觉（stdio）
//
// 画面：每 1.5 秒抓一次全屏（1280px JPEG）
// 声音：系统回环录音 5 秒切片，Windows zh-CN 离线识别转文字
// 不是逐帧视频理解；语音识别有误差。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import perception from '../../../console/perception-lib.cjs';

const server = new McpServer({ name: 'perception-mcp', version: '1.0.0' });
const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ content: [{ type: 'text', text: String(s) }], isError: true });

function statusText(s) {
  if (!s || !s.running) return '感知未运行。';
  return [
    `运行中（${s.mode === 'emulator' ? '模拟器' : '电脑'}）`,
    `已抓 ${s.frames || 0} 帧，已转 ${s.transcripts || 0} 段语音`,
    s.lastText ? `最近一句：${s.lastText}` : '还没识别到语音',
    s.lastError ? `错误：${s.lastError}` : '',
  ].filter(Boolean).join('\n');
}

server.tool(
  'perception_start',
  '开始持续感知：每 1.5 秒抓全屏，同时录系统声音并用 zh-CN 离线识别转文字。适合看抖音/视频/直播。不是逐帧视频理解，语音识别有误差。',
  {
    mode: z.enum(['pc', 'emulator']).default('pc').describe('pc=电脑画面；emulator=MuMu 模拟器画面'),
    seconds: z.number().int().min(0).default(0).describe('持续秒数；0=一直跑，直到 perception_stop'),
    audio: z.boolean().default(true).describe('是否录系统声音'),
  },
  async ({ mode, seconds, audio }) => {
    try {
      const r = await perception.start({ mode, seconds, audio });
      if (!r.ok) return fail(r.error || '启动失败');
      return text(`已开始持续感知（${mode === 'emulator' ? '模拟器' : '电脑'}，${seconds ? seconds + ' 秒' : '一直跑'}）。\n${statusText(r.status)}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'perception_read',
  '读取当前感知：最新一帧画面 + 最近 20 段语音转写 + 状态。先 perception_start。',
  {},
  async () => {
    try {
      const r = perception.read();
      const lines = [];
      lines.push(statusText(r.status));
      if (r.transcript.length) {
        lines.push('\n最近语音：');
        for (const x of r.transcript) lines.push(`[${x.ts}] ${x.text}`);
      } else {
        lines.push('\n（还没转出语音；可能没声音、静音，或刚开始）');
      }
      const content = [{ type: 'text', text: lines.join('\n') }];
      if (r.latest) {
        content.push({ type: 'image', data: r.latest.toString('base64'), mimeType: 'image/jpeg' });
      }
      return { content };
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'perception_stop',
  '停止持续感知，释放录音和抓屏。',
  {},
  async () => {
    try {
      const r = await perception.stop();
      return text('已停止感知。\n' + statusText(r.status));
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'perception_status',
  '查看感知状态（是否在跑、抓了多少帧、转了多少段语音）。',
  {},
  async () => {
    try { return text(statusText(perception.status())); }
    catch (e) { return fail(e.message); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[perception-mcp] ready');