'use strict';
/**
 * memory-lib · 长期记忆核心（CJS，控制台 / memory-mcp / bili-runner 共用）
 *
 * 唯一数据源：console/data/memory.json
 * 分类：facts（事实）/ preferences（偏好）/ promises（承诺提醒）/
 *       relations（关系）/ feedback（反馈）/ events（最近事件）
 *
 * 每次写入都会把一份摘要同步进「当前人格文件」的自动生成区块，
 * 这样 QQ agent 每轮都能看到长期记忆，不依赖它主动调用工具。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.APP_HOME ? path.resolve(process.env.APP_HOME) : path.resolve(__dirname, '..');
const MEMORY_FILE = path.join(ROOT, 'console', 'data', 'memory.json');
const QQ_DIR = process.env.QQ_BRIDGE_DIR ? path.resolve(process.env.QQ_BRIDGE_DIR) : path.join(ROOT, 'qq-bridge');
const ROLE_DIR = path.join(QQ_DIR, 'roles');
const CURRENT_ROLE = path.join(QQ_DIR, 'state', 'current-role.json');

const MARK_BEGIN = '<!-- MEMORY:BEGIN (auto-generated; do not edit inside) -->';
const MARK_END = '<!-- MEMORY:END -->';

const CATEGORIES = ['facts', 'preferences', 'promises', 'relations', 'feedback', 'events'];
const CAT_LABEL = {
  facts: '事实',
  preferences: '偏好',
  promises: '承诺/提醒',
  relations: '关系',
  feedback: '反馈',
  events: '最近事件',
};
const MAX_PER_CAT = {
  facts: 60, preferences: 60, promises: 40,
  relations: 20, feedback: 60, events: 40,
};
const SUMMARY_LIMIT = {
  facts: 12, preferences: 12, promises: 8,
  relations: 6, feedback: 12, events: 5,
};

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function normText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function emptyMemory() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    facts: [], preferences: [], promises: [], relations: [], feedback: [], events: [],
  };
}
function normalize(j) {
  const m = emptyMemory();
  for (const c of CATEGORIES) {
    if (!Array.isArray(j?.[c])) continue;
    m[c] = j[c]
      .filter((e) => e && normText(e.text))
      .map((e) => ({
        id: e.id || newId(),
        text: normText(e.text).slice(0, 220),
        source: String(e.source || '').slice(0, 40),
        target: String(e.target || '').slice(0, 40),
        dueAt: String(e.dueAt || '').slice(0, 40),
        done: !!e.done,
        at: e.at || e.createdAt || new Date().toISOString(),
      }))
      .slice(0, MAX_PER_CAT[c] || 60);
  }
  return m;
}
function loadMemory() {
  try {
    return normalize(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')));
  } catch {
    return emptyMemory();
  }
}
function saveMemory(m) {
  m.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(m, null, 2), 'utf8');
  return m;
}

function addEntry(category, text, opts = {}) {
  if (!CATEGORIES.includes(category)) throw new Error('未知分类：' + category);
  const t = normText(text).slice(0, 220);
  if (!t) throw new Error('内容为空');
  const m = loadMemory();
  const dup = m[category].find((e) => normText(e.text) === t);
  if (dup) {
    dup.at = new Date().toISOString();
    if (opts.dueAt) dup.dueAt = String(opts.dueAt).slice(0, 40);
    if (opts.done !== undefined) dup.done = !!opts.done;
    saveMemory(m);
    syncRoleBlock();
    return { entry: dup, duplicate: true };
  }
  const entry = {
    id: newId(),
    text: t,
    source: String(opts.source || 'manual').slice(0, 40),
    target: String(opts.target || '').slice(0, 40),
    dueAt: String(opts.dueAt || '').slice(0, 40),
    done: !!opts.done,
    at: new Date().toISOString(),
  };
  m[category].unshift(entry);
  const cap = MAX_PER_CAT[category] || 60;
  if (m[category].length > cap) m[category] = m[category].slice(0, cap);
  saveMemory(m);
  syncRoleBlock();
  return { entry, duplicate: false };
}

function findEntry(m, idOrText) {
  const want = normText(idOrText);
  if (!want) return null;
  for (const c of CATEGORIES) {
    const hit = m[c].find((e) => e.id === idOrText)
      || m[c].find((e) => normText(e.text) === want)
      || m[c].find((e) => normText(e.text).includes(want));
    if (hit) return { category: c, entry: hit };
  }
  return null;
}

function removeEntry(idOrText) {
  const m = loadMemory();
  const found = findEntry(m, idOrText);
  if (!found) return { ok: false, error: '没找到这条记忆' };
  m[found.category] = m[found.category].filter((e) => e.id !== found.entry.id);
  saveMemory(m);
  syncRoleBlock();
  return { ok: true, removed: found.entry, category: found.category };
}

function updateEntry(id, patch = {}) {
  const m = loadMemory();
  const found = findEntry(m, id);
  if (!found) return { ok: false, error: '没找到这条记忆' };
  const e = found.entry;
  if (patch.text !== undefined) {
    const t = normText(patch.text).slice(0, 220);
    if (t) e.text = t;
  }
  if (patch.target !== undefined) e.target = String(patch.target || '').slice(0, 40);
  if (patch.dueAt !== undefined) e.dueAt = String(patch.dueAt || '').slice(0, 40);
  if (patch.done !== undefined) e.done = !!patch.done;
  e.at = new Date().toISOString();
  saveMemory(m);
  syncRoleBlock();
  return { ok: true, entry: e, category: found.category };
}

function searchEntries(query) {
  const q = normText(query).toLowerCase();
  if (!q) return [];
  const m = loadMemory();
  const out = [];
  for (const c of CATEGORIES) {
    for (const e of m[c]) {
      if (normText(e.text).toLowerCase().includes(q) || normText(e.target).toLowerCase().includes(q)) {
        out.push({ category: c, ...e });
      }
    }
  }
  return out;
}

function renderSummary() {
  const m = loadMemory();
  const lines = [];
  for (const c of CATEGORIES) {
    const list = m[c] || [];
    if (!list.length) continue;
    let items = list;
    if (c === 'promises') {
      const now = Date.now();
      items = list.filter((e) => {
        if (e.done) return false;
        if (e.dueAt) {
          const t = Date.parse(String(e.dueAt).replace(' ', 'T'));
          if (Number.isFinite(t) && t < now) return false; // 已过期的约定不再展示
        }
        return true;
      });
      if (!items.length) continue;
    }
    if (c === 'events') items = list.slice(0, SUMMARY_LIMIT.events);
    else items = list.slice(0, SUMMARY_LIMIT[c] || 10);
    const text = items.map((e) => {
      let s = e.text;
      if (e.target) s = `${e.target}：${s}`;
      if (e.dueAt) s += `（${e.dueAt}）`;
      return s;
    }).join('；');
    lines.push(`- ${CAT_LABEL[c]}：${text}`);
  }
  return lines.length ? lines.join('\n') : '- （还没有长期记忆）';
}

function renderRoleBlock() {
  return `${MARK_BEGIN}\n## 长期记忆（自动同步，勿手改这一段）\n${renderSummary()}\n${MARK_END}`;
}

function activeRoleFile() {
  try {
    const j = JSON.parse(fs.readFileSync(CURRENT_ROLE, 'utf8'));
    const name = j.role || j.name || j.current;
    if (name) return path.join(ROLE_DIR, `${name}.md`);
  } catch {}
  return path.join(ROLE_DIR, '小鲸鱼.md');
}

function syncRoleBlock(file = activeRoleFile()) {
  try {
    let s = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const block = renderRoleBlock();
    const i = s.indexOf(MARK_BEGIN);
    const j = s.indexOf(MARK_END);
    if (i >= 0 && j > i) {
      s = s.slice(0, i) + block + s.slice(j + MARK_END.length);
    } else {
      s = s.replace(/\s*$/, '') + '\n\n' + block + '\n';
    }
    fs.writeFileSync(file, s, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function counts() {
  const m = loadMemory();
  const out = {};
  let total = 0;
  for (const c of CATEGORIES) { out[c] = (m[c] || []).length; total += out[c]; }
  out.total = total;
  return out;
}

function mergeEntries(entries, opts = {}) {
  const added = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const cat = CATEGORIES.includes(e?.category) ? e.category : 'facts';
    const t = normText(e?.text);
    if (!t) continue;
    try {
      const r = addEntry(cat, t, { source: opts.source || 'distill', target: e.target, dueAt: e.dueAt });
      if (!r.duplicate) added.push({ category: cat, ...r.entry });
    } catch {}
  }
  return added;
}

module.exports = {
  MEMORY_FILE,
  CATEGORIES,
  CAT_LABEL,
  MARK_BEGIN,
  MARK_END,
  loadMemory,
  saveMemory,
  emptyMemory,
  normalize,
  addEntry,
  removeEntry,
  updateEntry,
  searchEntries,
  renderSummary,
  renderRoleBlock,
  syncRoleBlock,
  activeRoleFile,
  counts,
  mergeEntries,
};