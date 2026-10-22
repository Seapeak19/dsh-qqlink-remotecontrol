// file-mcp · 文件 / Word / Excel / PDF / QQ 发文件（stdio）
//
// 默认无限制模式：可直接按路径读写本机文件；系统目录禁止写入，
// 敏感目录（.ssh / 凭据 / 浏览器数据）禁止访问。
// 文档引擎：console/file_tools.py（python-docx / openpyxl / pypdf / reportlab）
// PDF ↔ DOCX：console/word_convert.ps1（Word COM）
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fileLib from '../../../console/file-lib.cjs';

const server = new McpServer({ name: 'file-mcp', version: '1.0.0' });
const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ content: [{ type: 'text', text: String(s) }], isError: true });

function fmtList(r) {
  const lines = [`目录：${r.path}`];
  if (r.isFile) return lines.join('\n');
  if (!r.entries.length) return lines.concat('（空）').join('\n');
  for (const e of r.entries) {
    lines.push(`${e.dir ? '[目录]' : '[文件]'} ${e.name}${e.dir ? '' : '  ' + e.size + ' bytes'}`);
  }
  return lines.join('\n');
}

server.tool(
  'file_roots',
  '查看文件访问模式与常用文件夹。默认无限制模式：可直接按路径操作本机文件（系统/敏感目录除外）。',
  {},
  async () => {
    const roots = fileLib.listRoots();
    const mode = fileLib.isUnrestricted()
      ? '无限制模式：可直接按路径读写（系统目录禁止写入；.ssh/凭据/浏览器数据禁止访问）'
      : '受限模式：只能访问常用文件夹';
    const lines = [mode];
    if (roots.length) lines.push('常用文件夹：\n' + roots.map((r) => `- ${r.path}`).join('\n'));
    return text(lines.join('\n'));
  }
);

server.tool(
  'file_list',
  '列出本机目录（或文件）的内容。path 省略时用第一个常用文件夹。支持任意路径。',
  { path: z.string().optional().describe('目录路径；任意路径，系统/敏感目录除外') },
  async ({ path }) => {
    try { return text(fmtList(fileLib.listDir(path))); }
    catch (e) { return fail(e.message); }
  }
);

server.tool(
  'file_read',
  '读取文件：文本直接读，.docx 读段落，.xlsx 读单元格，.pdf 读页数和文字。只读。',
  { path: z.string().describe('文件路径；任意路径，系统/敏感目录除外') },
  async ({ path }) => {
    try {
      const r = await fileLib.preview(path);
      if (r.kind === 'docx') return text(`Word：${r.path}\n段落 ${r.paragraphCount}\n\n${r.text || '（空）'}`);
      if (r.kind === 'xlsx') {
        const rows = (r.rows || []).map((row) => row.join('\t')).join('\n');
        return text(`Excel：${r.path}\n工作表：${(r.sheets || []).join(', ')}\n当前：${r.sheet} ${r.dimensions}\n\n${rows || '（空）'}`);
      }
      if (r.kind === 'pdf') {
        const body = (r.texts || []).map((t) => `--- 第 ${t.page} 页 ---\n${t.text}`).join('\n');
        return text(`PDF：${r.path}\n页数：${r.pages}\n\n${body.slice(0, 9000) || '（未提取到文字，可能是扫描件）'}`);
      }
      if (r.kind === 'text') return text(`文本：${r.path}\n\n${r.text}`);
      return text(r.message || '不支持预览');
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'docx_read',
  '读取 .docx 的段落和表格内容。',
  { path: z.string().describe('docx 路径；任意路径') },
  async ({ path }) => {
    try {
      const r = await fileLib.docxRead(path);
      const paras = (r.paragraphs || []).filter((x) => x.trim()).slice(0, 200);
      const tables = (r.tables || []).slice(0, 10);
      let out = `段落 ${r.paragraphCount} 个：\n` + paras.map((p, i) => `${i + 1}. ${p}`).join('\n');
      if (tables.length) {
        out += '\n\n表格：';
        for (const t of tables) out += '\n' + t.map((row) => row.join(' | ')).join('\n');
      }
      return text(out || '（空文档）');
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'docx_edit',
  '修改 .docx：查找替换（find→replace）、追加段落（append），可另存为 saveAs。保存前自动生成 .bak 备份。修改前先 docx_read 看清内容。',
  {
    path: z.string().describe('docx 路径；任意路径'),
    find: z.string().optional().describe('要查找的文字'),
    replace: z.string().optional().describe('替换成什么（可为空）'),
    append: z.string().optional().describe('在文末追加的段落（可多行）'),
    saveAs: z.string().optional().describe('另存为路径；省略则覆盖原文件'),
  },
  async ({ path, find, replace, append, saveAs }) => {
    try {
      const r = await fileLib.docxEdit(path, { find, replace, append, saveAs });
      return text(`已保存：${r.path}\n替换 ${r.changed} 处${r.appended ? '，并追加了段落' : ''}${r.backup ? '\n备份：' + r.backup : ''}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'xlsx_read',
  '读取 .xlsx 的单元格（前 200 行 × 50 列）。可以指定工作表。',
  {
    path: z.string().describe('xlsx 路径；任意路径'),
    sheet: z.string().optional().describe('工作表名；省略用当前活动表'),
  },
  async ({ path, sheet }) => {
    try {
      const r = await fileLib.xlsxRead(path, sheet);
      const rows = (r.rows || []).map((row, i) => `${i + 1}: ${row.join('\t')}`).join('\n');
      return text(`工作表：${(r.sheets || []).join(', ')}\n当前：${r.sheet} ${r.dimensions}\n\n${rows || '（空）'}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'xlsx_edit',
  '修改 .xlsx：按单元格写值（cells: [{cell:"A1",value:"..."}]）或追加行（appendRows: [["a","b"]]），可另存为 saveAs。保存前自动生成 .bak 备份。公式以 = 开头。',
  {
    path: z.string().describe('xlsx 路径；任意路径'),
    sheet: z.string().optional().describe('工作表名；省略用当前活动表'),
    cells: z.array(z.object({ cell: z.string(), value: z.any() })).optional().describe('要写的单元格'),
    appendRows: z.array(z.array(z.any())).optional().describe('追加的行'),
    saveAs: z.string().optional().describe('另存为路径；省略则覆盖原文件'),
  },
  async ({ path, sheet, cells, appendRows, saveAs }) => {
    try {
      const r = await fileLib.xlsxEdit(path, { sheet, cells, appendRows, saveAs });
      return text(`已保存：${r.path}\n工作表 ${r.sheet}，写入 ${r.changed} 处${r.backup ? '\n备份：' + r.backup : ''}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'file_write_text',
  '写入文本文件（.txt/.md/.csv/.json），会生成 .bak 备份。支持任意路径（系统目录除外）。',
  {
    path: z.string().describe('文件路径；任意路径，系统目录除外'),
    content: z.string().describe('要写入的内容'),
  },
  async ({ path, content }) => {
    try {
      const r = fileLib.writeText(path, content);
      return text(`已写入：${r.path}（${r.bytes} bytes，已备份 .bak）`);
    } catch (e) { return fail(e.message); }
  }
);

// ── PDF ─────────────────────────────────────────────────────
server.tool(
  'pdf_info',
  '读取 PDF 的页数、元数据和每页文字（前 50 页）。扫描件可能提取不到文字。',
  { path: z.string().describe('PDF 路径；任意路径') },
  async ({ path }) => {
    try {
      const r = await fileLib.pdfInfo(path);
      const body = (r.texts || []).map((t) => `--- 第 ${t.page} 页 ---\n${t.text}`).join('\n');
      return text(`PDF：${r.path}\n页数：${r.pages}\n元数据：${JSON.stringify(r.metadata || {})}\n\n${body.slice(0, 9000)}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'pdf_extract',
  '从 PDF 抽取指定页，另存为新 PDF。pages 例："1-3,5"；省略表示全部。',
  {
    path: z.string().describe('源 PDF 路径'),
    pages: z.string().optional().describe('页码，例 1-3,5'),
    saveAs: z.string().describe('输出的新 PDF 路径'),
  },
  async ({ path, pages, saveAs }) => {
    try {
      const r = await fileLib.pdfExtract(path, pages, saveAs);
      return text(`已抽取并保存：${r.path}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'pdf_merge',
  '把多个 PDF 按顺序合并成一个新 PDF。',
  {
    paths: z.array(z.string()).min(2).describe('要合并的 PDF 路径列表'),
    saveAs: z.string().describe('输出的新 PDF 路径'),
  },
  async ({ paths, saveAs }) => {
    try {
      const r = await fileLib.pdfMerge(paths, saveAs);
      return text(`已合并：${r.path}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'pdf_rotate',
  '旋转 PDF 的指定页，另存为新 PDF。angle 常用 90/180/270。',
  {
    path: z.string().describe('源 PDF 路径'),
    pages: z.string().optional().describe('页码，例 1-3,5；省略表示全部'),
    angle: z.number().int().default(90).describe('旋转角度'),
    saveAs: z.string().describe('输出的新 PDF 路径'),
  },
  async ({ path, pages, angle, saveAs }) => {
    try {
      const r = await fileLib.pdfRotate(path, pages, angle, saveAs);
      return text(`已旋转并保存：${r.path}（${r.rotated} 页，${r.angle}°）`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'pdf_add_text',
  '在 PDF 指定页上叠加一段文字（支持中文），另存为新 PDF。x/y 从页面左上角算，单位 point（72≈1英寸）。',
  {
    path: z.string().describe('源 PDF 路径'),
    text: z.string().describe('要叠加的文字（可多行）'),
    page: z.number().int().min(1).default(1).describe('页码，从 1 开始'),
    x: z.number().default(72).describe('距左边距离'),
    y: z.number().default(72).describe('距顶部距离'),
    fontSize: z.number().default(14).describe('字号'),
    saveAs: z.string().describe('输出的新 PDF 路径'),
  },
  async ({ path, text: content, page, x, y, fontSize, saveAs }) => {
    try {
      const r = await fileLib.pdfAddText(path, content, { page, x, y, fontSize, saveAs });
      return text(`已叠加文字并保存：${r.path}（第 ${r.page} 页）`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'pdf_to_docx',
  '提取 PDF 文字生成 .docx（不保留原始排版、图片和表格样式），适合改文字；改完可用 docx_to_pdf 导回。复杂版式请用 Word/WPS 手动转换。',
  {
    path: z.string().describe('源 PDF 路径'),
    saveAs: z.string().describe('输出的 .docx 路径'),
  },
  async ({ path, saveAs }) => {
    try {
      const r = await fileLib.pdfToDocx(path, saveAs);
      return text(`已提取 PDF 文字生成 Word：${r.path}（${r.pages} 页；未保留排版）`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'docx_to_pdf',
  '用 Word 把 .docx 导出为 PDF。',
  {
    path: z.string().describe('源 docx 路径'),
    saveAs: z.string().describe('输出的 .pdf 路径'),
  },
  async ({ path, saveAs }) => {
    try {
      const r = await fileLib.docxToPdf(path, saveAs);
      return text(`已导出 PDF：${r.path}`);
    } catch (e) { return fail(e.message); }
  }
);

server.tool(
  'file_send_qq',
  '把一个文件通过 QQ 发给用户（私聊文件）。只发用户明确指定的文件，≤20MB。',
  {
    path: z.string().describe('文件路径；任意路径，敏感目录除外'),
    name: z.string().optional().describe('发送时显示的文件名；省略用原名'),
  },
  async ({ path, name }) => {
    try {
      const r = await fileLib.sendQQFile(path, name);
      return text(`已发送到用户 QQ：${r.name}（${r.size} bytes）`);
    } catch (e) { return fail(e.message); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[file-mcp] ready · ' + fileLib.FILES_CFG);