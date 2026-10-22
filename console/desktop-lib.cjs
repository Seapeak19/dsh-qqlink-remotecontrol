'use strict';
/**
 * desktop-lib · Windows 应用授权与桌面操作（CJS）
 *
 * 授权名单：console/data/apps.json
 * 驱动脚本：console/desktop.ps1
 *
 * 安全边界：
 *  - 只有 apps.json 里 enabled 的应用能被操作；
 *  - 只按进程名 + 可选标题正则找窗口；
 *  - 点击坐标必须落在该窗口范围内；
 *  - 不提供任意 exe / 任意窗口的操作入口。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT = process.env.APP_HOME ? path.resolve(process.env.APP_HOME) : path.resolve(__dirname, '..');
const APPS_FILE = path.join(ROOT, 'console', 'data', 'apps.json');
const PS1 = path.join(ROOT, 'console', 'desktop.ps1');
const LOG_DIR = path.join(ROOT, 'console', 'logs');
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const ACTIONS = ['launch', 'windows', 'focus', 'snapshot', 'click', 'type', 'key', 'scroll'];

function slug(s) {
  return String(s || 'app').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'app';
}

function normalizeApp(a) {
  if (!a) return null;
  if (!a.process && !a.screen) return null;
  const allow = Array.isArray(a.allow) ? a.allow.filter((x) => ACTIONS.includes(x)) : ACTIONS.slice();
  return {
    id: String(a.id || slug(a.name || a.process || 'desktop')),
    name: String(a.name || a.process || '桌面').slice(0, 40),
    process: String(a.process || ''),
    exe: String(a.exe || ''),
    titlePattern: String(a.titlePattern || ''),
    screen: !!a.screen,
    allow: allow.length ? allow : ACTIONS.slice(),
    enabled: a.enabled !== false,
    createdAt: a.createdAt || new Date().toISOString(),
  };
}

function loadStore() {
  try {
    const j = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
    return { apps: Array.isArray(j?.apps) ? j.apps.map(normalizeApp).filter(Boolean) : [] };
  } catch {
    return { apps: [] };
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(APPS_FILE), { recursive: true });
  fs.writeFileSync(APPS_FILE, JSON.stringify({ apps: store.apps }, null, 2), 'utf8');
}

function listApps() { return loadStore().apps; }

function getApp(id) {
  const want = String(id || '');
  return loadStore().apps.find((a) => a.id === want) || null;
}

function addApp(input = {}) {
  const process = String(input.process || '').trim();
  if (!/^[A-Za-z0-9._-]+$/.test(process)) throw new Error('进程名不合法（字母/数字/._-）');
  const name = (String(input.name || process).trim() || process).slice(0, 40);
  const store = loadStore();
  if (store.apps.some((a) => a.process.toLowerCase() === process.toLowerCase())) {
    throw new Error('这个进程已经授权过了');
  }
  let id = slug(input.id || name);
  let base = id, n = 2;
  while (store.apps.some((a) => a.id === id)) { id = `${base}-${n++}`; }
  const allow = Array.isArray(input.allow) ? input.allow.filter((x) => ACTIONS.includes(x)) : ACTIONS.slice();
  const app = {
    id,
    name,
    process,
    exe: String(input.exe || '').trim(),
    titlePattern: String(input.titlePattern || '').trim(),
    allow: allow.length ? allow : ACTIONS.slice(),
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  store.apps.push(app);
  saveStore(store);
  return app;
}

function removeApp(id) {
  const store = loadStore();
  const before = store.apps.length;
  store.apps = store.apps.filter((a) => a.id !== id);
  saveStore(store);
  return store.apps.length < before;
}

function toggleApp(id, enabled) {
  const store = loadStore();
  const app = store.apps.find((a) => a.id === id);
  if (!app) return null;
  app.enabled = !!enabled;
  saveStore(store);
  return app;
}

function requireApp(id, action) {
  const app = getApp(id);
  if (!app) throw new Error('应用未授权：' + (id || '(空)'));
  if (!app.enabled) throw new Error('应用已停用：' + app.name);
  if (action && !app.allow.includes(action)) throw new Error(`应用「${app.name}」未授权动作：${action}`);
  return app;
}

function runDesktop(action, params = {}, timeout = 30000) {
  const file = path.join(os.tmpdir(), `desktop-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ action, ...params }), 'utf8');
  return new Promise((resolve) => {
    execFile(POWERSHELL, [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', PS1, '-ArgsFile', file,
    ], {
      timeout,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      try { fs.unlinkSync(file); } catch {}
      const text = String(stdout || '').trim();
      const lines = text.split(/\r?\n/).map((l) => l.replace(/^\uFEFF/, '').trim()).filter((l) => l.startsWith('{'));
      let obj = null;
      for (let i = lines.length - 1; i >= 0 && !obj; i--) {
        try { obj = JSON.parse(lines[i]); } catch {}
      }
      if (!obj) {
        resolve({
          ok: false,
          error: (stderr || err?.message || 'PowerShell 没有返回 JSON').slice(0, 800),
          raw: text.slice(-800),
        });
        return;
      }
      resolve(obj);
    });
  });
}

async function listRunning() {
  const r = await runDesktop('list', {}, 20000);
  if (!r.ok) throw new Error(r.error || '列窗口失败');
  return r.items || [];
}

async function scanInstalled() {
  const r = await runDesktop('installed', {}, 60000);
  if (!r.ok) throw new Error(r.error || '扫描已安装软件失败');
  return r.items || [];
}

async function pickExe() {
  return runDesktop('pick-exe', {}, 180000);
}

async function inspectExe(exe) {
  const r = await runDesktop('inspect', { exe }, 15000);
  if (!r.ok) throw new Error(r.error || '识别 exe 失败');
  return r;
}

async function screenSnapshot() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = path.join(LOG_DIR, 'app-desktop.png');
  const r = await runDesktop('screen', { out }, 25000);
  return { ...r, path: out };
}

async function pickFolder() {
  return runDesktop('pick-folder', {}, 180000);
}

async function launch(app) {
  if (!app.exe) throw new Error('这个应用没有配置 exe 路径，无法启动');
  return runDesktop('launch', {
    exe: app.exe,
    process: app.process,
    titlePattern: app.titlePattern,
  }, 45000);
}

async function snapshot(app) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = path.join(LOG_DIR, `app-${app.id}.png`);
  const r = await runDesktop('snapshot', {
    process: app.process,
    titlePattern: app.titlePattern,
    out,
  }, 25000);
  return { ...r, path: out };
}

module.exports = {
  APPS_FILE,
  ACTIONS,
  listApps,
  getApp,
  addApp,
  removeApp,
  toggleApp,
  requireApp,
  runDesktop,
  listRunning,
  scanInstalled,
  pickExe,
  inspectExe,
  screenSnapshot,
  pickFolder,
  launch,
  snapshot,
};