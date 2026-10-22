'use strict';
/**
 * file-lib · 文件/文档/PDF/QQ 发文件（CJS）
 *
 * 模式：默认 unrestricted=true —— 不要求文件夹授权，直接按路径读写。
 * 安全底线：
 *  - 系统目录（Windows / Program Files / ProgramData）禁止写入；
 *  - 敏感目录（.ssh / .gnupg / 凭据）禁止读写/发送；
 *  - 修改前自动 .bak 备份；
 *  - QQ 只发给主人，≤20MB。
 *
 * 文档：console/file_tools.py（python-docx / openpyxl / pypdf / reportlab）
 * PDF↔DOCX：console/word_convert.ps1（Word COM）
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = process.env.APP_HOME ? path.resolve(process.env.APP_HOME) : path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'console', 'data');
const FILES_CFG = path.join(DATA_DIR, 'files.json');
const SHARED = path.join(ROOT, 'shared');
const PY_SCRIPT = path.join(ROOT, 'console', 'file_tools.py');
const PY_LIBS = path.join(ROOT, 'console', 'pylibs');
const WORD_PS1 = path.join(ROOT, 'console', 'word_convert.ps1');
const PYTHON = process.env.PYTHON || 'python';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const QQ_DIR = process.env.QQ_BRIDGE_DIR ? path.resolve(process.env.QQ_BRIDGE_DIR) : path.join(ROOT, 'qq-bridge');
const QQ_CFG = path.join(QQ_DIR, 'config.json');
const HOME = process.env.USERPROFILE || process.env.HOME || '';

const TEXT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.log', '.js', '.py', '.html', '.css', '.yml', '.yaml']);
const EDIT_EXT = new Set(['.txt', '.md', '.csv', '.json', '.docx', '.xlsx']);
const MAX_SEND_BYTES = 20 * 1024 * 1024;

const SYSTEM_DIRS = ['c:\\windows\\', 'c:\\program files\\', 'c:\\program files (x86)\\', 'c:\\programdata\\'];
const SENSITIVE_MARKS = [
  '\\.ssh\\', '\\.gnupg\\',
  '\\appdata\\roaming\\microsoft\\crypto\\',
  '\\appdata\\local\\microsoft\\credentials\\',
  '\\appdata\\roaming\\microsoft\\credentials\\',
  '\\appdata\\local\\google\\chrome\\user data\\',
  '\\appdata\\roaming\\mozilla\\firefox\\profiles\\',
];

function defaultCfg() {
  const roots = [];
  try { fs.mkdirSync(SHARED, { recursive: true }); } catch {}
  roots.push(SHARED);
  if (HOME) {
    const docs = path.join(HOME, 'Documents');
    if (fs.existsSync(docs)) roots.push(docs);
  }
  return { unrestricted: false, roots, allowExtensions: ['.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pdf'] };
}

function normalizeCfg(j) {
  const d = defaultCfg();
  const roots = [];
  for (const r of Array.isArray(j?.roots) ? j.roots : d.roots) {
    try {
      if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) continue;
      const real = fs.realpathSync(r);
      if (!roots.some((x) => x.toLowerCase() === real.toLowerCase())) roots.push(real);
    } catch {}
  }
  if (!roots.length) roots.push(SHARED);
  return {
    unrestricted: j?.unrestricted === true,
    roots,
    allowExtensions: d.allowExtensions,
  };
}

function loadCfg() {
  try { return normalizeCfg(JSON.parse(fs.readFileSync(FILES_CFG, 'utf8'))); }
  catch { return normalizeCfg(defaultCfg()); }
}

function saveCfg(cfg) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILES_CFG, JSON.stringify(cfg, null, 2), 'utf8');
}

function listRoots() {
  const cfg = loadCfg();
  return cfg.roots.map((r) => ({ path: r, name: path.basename(r) || r, exists: fs.existsSync(r) }));
}

function isUnrestricted() {
  return loadCfg().unrestricted;
}

function addRoot(p) {
  const abs = path.resolve(String(p || ''));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('文件夹不存在：' + abs);
  const real = fs.realpathSync(abs);
  const cfg = loadCfg();
  if (!cfg.roots.some((r) => r.toLowerCase() === real.toLowerCase())) {
    cfg.roots.push(real);
    saveCfg(cfg);
  }
  return { path: real, roots: listRoots() };
}

function removeRoot(p) {
  const want = String(p || '').toLowerCase();
  const cfg = loadCfg();
  cfg.roots = cfg.roots.filter((r) => r.toLowerCase() !== want);
  saveCfg(cfg);
  return listRoots();
}

function isInside(root, target) {
  const rel = path.relative(root.toLowerCase(), target.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function realPathOf(p) {
  const abs = path.resolve(String(p));
  try { return fs.realpathSync(abs); }
  catch {
    const parent = fs.realpathSync(path.dirname(abs));
    return path.join(parent, path.basename(abs));
  }
}

function assertNotSensitive(real) {
  const lower = real.toLowerCase();
  if (SENSITIVE_MARKS.some((m) => lower.includes(m))) {
    throw new Error('这个路径属于敏感目录（凭据/密钥/浏览器数据），不允许访问');
  }
}

function resolveAllowed(p) {
  if (!p) throw new Error('缺少路径');
  const real = realPathOf(p);
  assertNotSensitive(real);
  const cfg = loadCfg();
  if (!cfg.unrestricted) {
    const hit = cfg.roots.find((r) => {
      try { return isInside(fs.realpathSync(r), real); } catch { return false; }
    });
    if (!hit) throw new Error('路径不在授权文件夹内：' + real);
  }
  return real;
}

function resolveWritable(p) {
  const real = resolveAllowed(p);
  const lower = real.toLowerCase();
  if (SYSTEM_DIRS.some((d) => lower.startsWith(d))) {
    throw new Error('系统目录不允许写入：' + real);
  }
  return real;
}

function listDir(p) {
  const cfg = loadCfg();
  const fallback = cfg.roots[0] || HOME;
  const target = resolveAllowed(p || fallback);
  const st = fs.statSync(target);
  if (st.isFile()) {
    return { path: target, parent: path.dirname(target), entries: [], isFile: true };
  }
  const entries = [];
  for (const d of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, d.name);
    let size = 0, modified = '';
    try { const s = fs.statSync(full); size = s.size; modified = s.mtime.toISOString(); } catch {}
    entries.push({
      name: d.name, path: full, dir: d.isDirectory(),
      ext: path.extname(d.name).toLowerCase(), size, modified,
    });
  }
  entries.sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name, 'zh-CN'));
  let parent = path.dirname(target);
  try { resolveAllowed(parent); } catch { parent = null; }
  return { path: target, parent, entries: entries.slice(0, 500), isFile: false };
}

function runPython(action, args) {
  if (!fs.existsSync(PYTHON)) throw new Error('找不到 Python：' + PYTHON);
  if (!fs.existsSync(PY_SCRIPT)) throw new Error('找不到 file_tools.py');
  const tmp = path.join(process.env.TEMP || 'C:\\Windows\\Temp', `fileargs-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(args), 'utf8');
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [PY_SCRIPT, action, tmp], {
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PYTHONPATH: PY_LIBS, PYTHONIOENCODING: 'utf-8' },
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch {}
      const text = String(stdout || '').trim();
      const lines = text.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim()).filter((l) => l.startsWith('{'));
      let obj = null;
      for (let i = lines.length - 1; i >= 0 && !obj; i--) {
        try { obj = JSON.parse(lines[i]); } catch {}
      }
      if (!obj) { reject(new Error((stderr || err?.message || 'Python 没有返回 JSON').slice(0, 800))); return; }
      if (!obj.ok) { reject(new Error(obj.error || 'Python 执行失败')); return; }
      resolve(obj);
    });
  });
}

function backupIfSame(src, dest) {
  try {
    if (path.resolve(src).toLowerCase() === path.resolve(dest).toLowerCase()) {
      fs.copyFileSync(src, src + '.bak');
      return src + '.bak';
    }
  } catch {}
  return null;
}

async function docxRead(p) {
  return runPython('docx_read', { path: resolveAllowed(p) });
}

async function docxEdit(p, opts = {}) {
  const src = resolveAllowed(p);
  const out = opts.saveAs ? resolveWritable(opts.saveAs) : src;
  const backup = backupIfSame(src, out);
  const r = await runPython('docx_edit', {
    path: src, saveAs: out,
    find: opts.find || '', replace: opts.replace || '', append: opts.append || '',
    backup,
  });
  return { ...r, backup };
}

async function xlsxRead(p, sheet) {
  return runPython('xlsx_read', { path: resolveAllowed(p), sheet: sheet || '' });
}

async function xlsxEdit(p, opts = {}) {
  const src = resolveAllowed(p);
  const out = opts.saveAs ? resolveWritable(opts.saveAs) : src;
  const backup = backupIfSame(src, out);
  const r = await runPython('xlsx_edit', {
    path: src, saveAs: out, sheet: opts.sheet || '',
    cells: Array.isArray(opts.cells) ? opts.cells : [],
    appendRows: Array.isArray(opts.appendRows) ? opts.appendRows : [],
    backup,
  });
  return { ...r, backup };
}

async function preview(p, maxChars = 12000) {
  const file = resolveAllowed(p);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') {
    const r = await docxRead(file);
    return { kind: 'docx', path: file, paragraphCount: r.paragraphCount, text: String(r.text || '').slice(0, maxChars), tables: (r.tables || []).slice(0, 5) };
  }
  if (ext === '.xlsx') {
    const r = await xlsxRead(file);
    return { kind: 'xlsx', path: file, sheets: r.sheets, sheet: r.sheet, dimensions: r.dimensions, rows: (r.rows || []).slice(0, 60) };
  }
  if (ext === '.pdf') {
    const r = await pdfInfo(file);
    return { kind: 'pdf', path: file, pages: r.pages, texts: (r.texts || []).slice(0, 5) };
  }
  if (TEXT_EXT.has(ext)) {
    return { kind: 'text', path: file, text: fs.readFileSync(file, 'utf8').slice(0, maxChars) };
  }
  return { kind: 'binary', path: file, message: '这个类型不支持预览（可以发送或在应用里打开）' };
}

function writeText(p, content) {
  const file = resolveWritable(p);
  const ext = path.extname(file).toLowerCase();
  if (!EDIT_EXT.has(ext)) throw new Error('不支持的写入类型：' + ext);
  if (fs.existsSync(file)) { try { fs.copyFileSync(file, file + '.bak'); } catch {} }
  fs.writeFileSync(file, String(content || ''), 'utf8');
  return { ok: true, path: file, bytes: Buffer.byteLength(String(content || ''), 'utf8') };
}

async function sendQQFile(p, name) {
  const file = resolveAllowed(p);
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('不是文件');
  if (st.size > MAX_SEND_BYTES) throw new Error('文件超过 20MB，QQ 发送限制');
  const bc = JSON.parse(fs.readFileSync(QQ_CFG, 'utf8'));
  const token = bc?.snowluma?.accessToken || '';
  const owner = Number(bc?.ownerQQ || 0);
  if (!token) throw new Error('没有 SnowLuma accessToken');
  if (!owner) throw new Error('qq-bridge/config.json 没有 ownerQQ');
  const r = await fetch('http://127.0.0.1:3000/upload_private_file', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ user_id: owner, file, name: name || path.basename(file) }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.status !== 'ok') throw new Error('QQ 发文件失败：' + JSON.stringify(j).slice(0, 300));
  return { ok: true, file, name: name || path.basename(file), size: st.size, data: j.data };
}

// ── PDF ─────────────────────────────────────────────────────
async function pdfInfo(p) {
  return runPython('pdf_info', { path: resolveAllowed(p) });
}

async function pdfExtract(p, pages, saveAs) {
  const src = resolveAllowed(p);
  const out = resolveWritable(saveAs);
  await runPython('pdf_extract', { path: src, pages: pages || '', saveAs: out });
  return { ok: true, path: out };
}

async function pdfMerge(paths, saveAs) {
  const list = (Array.isArray(paths) ? paths : []).map(resolveAllowed);
  if (list.length < 2) throw new Error('至少需要两个 PDF');
  const out = resolveWritable(saveAs);
  await runPython('pdf_merge', { paths: list, saveAs: out });
  return { ok: true, path: out };
}

async function pdfRotate(p, pages, angle, saveAs) {
  const src = resolveAllowed(p);
  const out = resolveWritable(saveAs);
  await runPython('pdf_rotate', { path: src, pages: pages || '', angle: Number(angle) || 90, saveAs: out });
  return { ok: true, path: out };
}

async function pdfAddText(p, text, opts = {}) {
  const src = resolveAllowed(p);
  const out = resolveWritable(opts.saveAs);
  await runPython('pdf_add_text', {
    path: src, saveAs: out, text: String(text || ''),
    page: Number(opts.page) || 1, x: Number(opts.x) || 72, y: Number(opts.y) || 72,
    fontSize: Number(opts.fontSize) || 14,
  });
  return { ok: true, path: out };
}

// ── Word COM：PDF ↔ DOCX ───────────────────────────────────
function runWordConvert(action, inPath, outPath) {
  return new Promise((resolve, reject) => {
    execFile(POWERSHELL, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', WORD_PS1,
      '-Action', action, '-InPath', inPath, '-OutPath', outPath,
    ], { timeout: 180000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, stdout, stderr) => {
      const text = String(stdout || '').trim();
      const lines = text.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim()).filter((l) => l.startsWith('{'));
      let obj = null;
      for (let i = lines.length - 1; i >= 0 && !obj; i--) {
        try { obj = JSON.parse(lines[i]); } catch {}
      }
      if (!obj) { reject(new Error((stderr || err?.message || 'Word 没有返回结果').slice(0, 800))); return; }
      if (!obj.ok) { reject(new Error(obj.error || 'Word 转换失败')); return; }
      resolve(obj);
    });
  });
}

async function pdfToDocx(p, saveAs) {
  const src = resolveAllowed(p);
  const out = resolveWritable(saveAs);
  const r = await runPython('pdf_text_to_docx', { path: src, saveAs: out });
  return { ok: true, path: out, textOnly: true, pages: r.pages };
}

async function docxToPdf(p, saveAs) {
  const src = resolveAllowed(p);
  const out = resolveWritable(saveAs);
  const r = await runWordConvert('docx2pdf', src, out);
  return { ok: true, path: out, ...r };
}

module.exports = {
  FILES_CFG,
  SHARED,
  HOME,
  listRoots,
  isUnrestricted,
  addRoot,
  removeRoot,
  resolveAllowed,
  resolveWritable,
  listDir,
  preview,
  docxRead,
  docxEdit,
  xlsxRead,
  xlsxEdit,
  writeText,
  sendQQFile,
  pdfInfo,
  pdfExtract,
  pdfMerge,
  pdfRotate,
  pdfAddText,
  pdfToDocx,
  docxToPdf,
};