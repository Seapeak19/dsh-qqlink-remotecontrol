// memory-mcp · 长期记忆 MCP 服务器（stdio）
//
// 给 QQ agent 用：读取/写入 console/data/memory.json。
// 写入后会把摘要同步进当前人格文件的自动生成区块，
// 这样即使 agent 不主动调用 memory_read，每轮人格里也能看到长期记忆。
//
// 复用 phone-mcp 的 node_modules（@modelcontextprotocol/sdk、zod）。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import memoryLib from '../../../console/memory-lib.cjs';

const server = new McpServer({ name: 'memory-mcp', version: '1.0.0' });

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ content: [{ type: 'text', text: String(s) }], isError: true });

server.tool(
  'memory_read',
  '读取长期记忆：用户相关的事实、偏好、反馈、承诺、关系、最近事件。想回忆用户的喜好/作息/约定时用；平时人格末尾也会自动带一份摘要。',
  { raw: z.boolean().optional().describe('true=返回完整 JSON；默认返回摘要') },
  async ({ raw }) => {
    try {
      if (raw) return text(JSON.stringify(memoryLib.loadMemory(), null, 2));
      const c = memoryLib.counts();
      return text(
        `长期记忆（共 ${c.total} 条：事实${c.facts}/偏好${c.preferences}/反馈${c.feedback}/承诺${c.promises}/关系${c.relations}/事件${c.events}）\n` +
        memoryLib.renderSummary()
      );
    } catch (e) {
      return fail('读取失败：' + (e?.message || e));
    }
  }
);

server.tool(
  'memory_write',
  '往长期记忆里记一条。用户明确表达喜欢/讨厌、让你记住重要的事、或和你定下约定时用。不要记密码、账号、隐私、一次性闲聊。',
  {
    category: z.enum(['facts', 'preferences', 'promises', 'relations', 'feedback', 'events']).describe('分类：facts 事实 / preferences 偏好 / promises 承诺提醒 / relations 关系 / feedback 反馈 / events 事件'),
    text: z.string().describe('内容，一条一件事，尽量 ≤60 字'),
    target: z.string().optional().describe('对象，例如“用户”'),
    dueAt: z.string().optional().describe('承诺时间，例如“2026-10-22 12:00”'),
  },
  async ({ category, text: content, target, dueAt }) => {
    try {
      const r = memoryLib.addEntry(category, content, { source: 'qq-agent', target, dueAt });
      return text(
        (r.duplicate ? '这条已经记过了：' : '记下了【' + memoryLib.CAT_LABEL[category] + '】：') + r.entry.text
      );
    } catch (e) {
      return fail('记录失败：' + (e?.message || e));
    }
  }
);

server.tool(
  'memory_forget',
  '忘掉一条长期记忆（按 id 或内容片段）。用户说“这个别记着”或记错时用。',
  { id: z.string().optional().describe('记忆 id'), text: z.string().optional().describe('内容片段') },
  async ({ id, text: q }) => {
    const r = memoryLib.removeEntry(id || q || '');
    return r.ok ? text('已忘掉：' + r.removed.text) : fail(r.error);
  }
);

server.tool(
  'memory_search',
  '在长期记忆里搜索关键词。',
  { query: z.string().describe('关键词') },
  async ({ query }) => {
    const hits = memoryLib.searchEntries(query);
    if (!hits.length) return text('没搜到相关记忆。');
    return text(
      hits.slice(0, 20).map((h) => `[${memoryLib.CAT_LABEL[h.category]}] ${h.text}${h.target ? '（' + h.target + '）' : ''}`).join('\n')
    );
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[memory-mcp] ready · ' + memoryLib.MEMORY_FILE);