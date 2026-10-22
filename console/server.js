/**
 * 小鲸鱼控制台 · 本地后端
 * ─────────────────────────────────────────────────────────────
 * 一个只监听 127.0.0.1 的 Node 服务：
 *   - 探测 DSH / SnowLuma / qq-bridge 状态（DSH 端口每次启动会变，自动发现）
 *   - 一键启动 / 停止 / 重启（DSH → SnowLuma → qq-bridge）
 *   - 读写 qq-bridge 配置、人格、模式
 *   - 代理 qq-bridge 控制台 API（3100）
 *   - 日志尾巴、开机自启开关
 *
 * 启动：node console/server.js
 * 界面：http://127.0.0.1:3900
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import memoryLib from './memory-lib.cjs';
import desktopLib from './desktop-lib.cjs';
import fileLib from './file-lib.cjs';
import perceptionLib from './perception-lib.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const DEFAULTS = {
  port: 3900,
  autoStart: false,
  autoStartDsh: false,
  dsh: { exe: process.platform === 'win32' ? 'C:\\path\\to\\DeepSeek Harness.exe' : '', baseUrl: '' },
  snowluma: { dir: '' },
  qqbridge: { dir: 'qq-bridge' },
  mumu: {
    manager: '',
    adb: '',
    instance: 0,
    serial: '127.0.0.1:16384',
    autoStart: false,
  },
  bili: {
    enabled: false,
    time: '20:00',
    max: 5,
    lastRunDay: '',
    lastRun: '',
  },
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else out[k] = v;
  }
  return out;
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}
let cfg = loadConfig();
function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}
if (!fs.existsSync(CONFIG_FILE)) saveConfig();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PowerShell ────────────────────────────────────────────────
function ps(script, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}
function parseJson(text, fallback) {
  try { return JSON.parse(String(text || '').trim()); } catch { return fallback; }
}

// ── 端口 / 进程 ───────────────────────────────────────────────
function portOpen(port, timeout = 300) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; s.destroy(); resolve(v); };
    s.setTimeout(timeout);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, '127.0.0.1');
  });
}

// ── 模拟器（MuMu） ───────────────────────────────────────────
function runFile(exe, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, {
      windowsHide: true,
      timeout: opts.timeout || 30000,
      maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
      encoding: opts.encoding || 'utf8',
    }, (err, stdout, stderr) => resolve({
      ok: !err,
      err,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
    }));
  });
}

async function mumuInfo() {
  try {
    if (!fs.existsSync(cfg.mumu.manager)) return null;
    const r = await runFile(cfg.mumu.manager, ['info', '-v', String(cfg.mumu.instance)], { timeout: 15000 });
    if (!r.ok) return null;
    return parseJson(r.stdout, null);
  } catch { return null; }
}

function adbRun(args, opts = {}) {
  return runFile(cfg.mumu.adb, ['-s', cfg.mumu.serial, ...args], opts);
}

async function mumuConnect() {
  const r = await runFile(cfg.mumu.adb, ['connect', cfg.mumu.serial], { timeout: 20000 });
  return r;
}

async function mumuStart() {
  const r = await runFile(cfg.mumu.manager, ['control', '-v', String(cfg.mumu.instance), 'launch'], { timeout: 120000 });
  if (!r.ok) throw new Error('MuMu 启动失败：' + (r.stderr || r.err?.message || ''));
  for (let i = 0; i < 60; i++) {
    const info = await mumuInfo();
    if (info?.is_android_started) {
      await mumuConnect();
      return info;
    }
    await sleep(2000);
  }
  throw new Error('模拟器启动超时（120 秒）');
}

async function mumuScreenshot() {
  const r = await adbRun(['exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 40000 });
  if (!r.ok || !r.stdout || !r.stdout.length) throw new Error('截图失败：' + (r.stderr || r.err?.message || '没有输出'));
  const file = path.join(LOG_DIR, 'phone.png');
  fs.writeFileSync(file, r.stdout);
  return file;
}

async function mumuApps() {
  const r = await adbRun(['shell', 'pm', 'list', 'packages'], { timeout: 30000 });
  if (!r.ok) throw new Error('列应用失败：' + (r.stderr || r.err?.message || ''));
  return String(r.stdout).split(/\r?\n/)
    .map((l) => l.trim().replace(/^package:/, ''))
    .filter(Boolean)
    .sort();
}

async function mumuOpenApp(pkg) {
  const r = await adbRun(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], { timeout: 30000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (!r.ok || /No activities found|monkey aborted|Error/i.test(out)) {
    throw new Error('打开失败：' + out.slice(0, 200));
  }
  return out.slice(0, 300);
}

async function mumuInstallKeyboard() {
  const apk = path.join(ROOT, 'packages', 'phone-mcp', 'ADBKeyboard.apk');
  if (!fs.existsSync(apk)) throw new Error('找不到 ADBKeyboard.apk：' + apk);
  const r = await adbRun(['install', '-r', apk], { timeout: 120000 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (!r.ok || !/Success/i.test(out)) throw new Error('安装失败：' + out.slice(0, 300));
  return out.trim();
}

async function phoneStatus() {
  const info = await mumuInfo();
  const dev = await runFile(cfg.mumu.adb, ['devices', '-l'], { timeout: 20000 });
  const devices = String(dev.stdout || '');
  const connected = devices.includes(cfg.mumu.serial);
  let androidVersion = '';
  let screen = '';
  let keyboard = false;
  if (connected) {
    const ver = await adbRun(['shell', 'getprop', 'ro.build.version.release'], { timeout: 15000 });
    androidVersion = String(ver.stdout || '').trim();
    const wm = await adbRun(['shell', 'wm', 'size'], { timeout: 15000 });
    screen = String(wm.stdout || '').trim();
    const ime = await adbRun(['shell', 'ime', 'list', '-a'], { timeout: 20000 });
    keyboard = /com\.android\.adbkeyboard/i.test(String(ime.stdout || ''));
  }
  return {
    manager: cfg.mumu.manager,
    adb: cfg.mumu.adb,
    serial: cfg.mumu.serial,
    instance: cfg.mumu.instance,
    autoStart: !!cfg.mumu.autoStart,
    info,
    connected,
    devices,
    androidVersion,
    screen,
    keyboard,
    hasShot: fs.existsSync(path.join(LOG_DIR, 'phone.png')),
  };
}

async function ensureEmulator() {
  if (!cfg.mumu?.autoStart) return null;
  if (!fs.existsSync(cfg.mumu.manager)) throw new Error('找不到 MuMuManager：' + cfg.mumu.manager);
  const info = await mumuInfo();
  if (!info?.is_android_started) {
    op.step = '启动模拟器…';
    await mumuStart();
  } else {
    op.step = '连接模拟器 adb…';
    await mumuConnect();
  }
  return phoneStatus();
}

// ── B 站每日任务（A 私信 + B 评论 @） ───────────────────────
let biliProc = null;
let biliLast = null;
let biliRetryDay = '';
let biliRetryCount = 0;
let biliRetryTimer = null;

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readBiliHistory(n = 20) {
  const file = path.join(LOG_DIR, 'bili-history.jsonl');
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/).filter(Boolean).slice(-n)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function biliDailyMax() {
  return Math.max(3, Math.min(7, Number(cfg.bili?.max) || 5));
}

function biliToday() {
  const today = localDate();
  let dm = 0, comment = 0, like = 0;
  for (const h of readBiliHistory(1000)) {
    if (localDate(new Date(h.ts)) !== today) continue;
    if (h.ok && h.action === 'dm') dm++;
    if (h.ok && h.action === 'comment') comment++;
    if (h.liked || (h.ok && h.like)) like++;
  }
  return { dm, comment, like, total: dm + comment };
}

function biliStatus() {
  const today = biliToday();
  const dailyMax = biliDailyMax();
  return {
    enabled: cfg.bili?.enabled !== false,
    time: cfg.bili?.time || '20:00',
    max: dailyMax,
    lastRun: cfg.bili?.lastRun || '',
    lastRunDay: cfg.bili?.lastRunDay || '',
    running: !!biliProc,
    last: biliLast,
    today: { ...today, target: dailyMax, remaining: Math.max(0, dailyMax - today.total) },
    retryCount: biliRetryDay === localDate() ? biliRetryCount : 0,
    history: readBiliHistory(20),
  };
}

function scheduleBiliRetry() {
  const t = biliToday();
  const dailyMax = biliDailyMax();
  if (t.total >= dailyMax) return;
  if (biliRetryDay !== localDate()) { biliRetryDay = localDate(); biliRetryCount = 0; }
  if (biliRetryCount >= 2) {
    console.log(`[console] B站今天补跑次数已用完（${t.total}/${dailyMax}）`);
    return;
  }
  biliRetryCount++;
  const delayMs = 15 * 60 * 1000;
  console.log(`[console] B站未达标（${t.total}/${dailyMax}），${delayMs / 60000} 分钟后补跑（第 ${biliRetryCount} 次）`);
  if (biliRetryTimer) clearTimeout(biliRetryTimer);
  biliRetryTimer = setTimeout(() => {
    biliRetryTimer = null;
    if (!biliProc) startBiliTask();
  }, delayMs);
}

function startBiliTask() {
  return { ok: false, error: 'B站自动任务已停用（模拟器里已删除 B站；需要时手动打开模拟器进 B站）' };
  if (biliProc) return { ok: false, error: 'B 站任务已在运行' };
  const runner = path.join(ROOT, 'console', 'bili-runner.cjs');
  if (!fs.existsSync(runner)) return { ok: false, error: '找不到 bili-runner.cjs' };

  const dailyMax = biliDailyMax();
  const today = biliToday();
  const remaining = dailyMax - today.total;
  if (remaining < 1) {
    cfg.bili.lastRunDay = localDate();
    saveConfig();
    return { ok: false, error: `今天已完成 ${today.total} 条，达到上限 ${dailyMax}` };
  }
  const max = Math.min(remaining, 7);

  const logFile = path.join(LOG_DIR, 'bili-task.log');
  let out;
  try { out = fs.openSync(logFile, 'a'); } catch { out = 'ignore'; }
  let child;
  try {
    child = spawn(process.execPath, [runner, `--max=${max}`], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', out, out],
    });
  } catch (e) {
    if (typeof out === 'number') { try { fs.closeSync(out); } catch {} }
    return { ok: false, error: String(e?.message || e) };
  }

  biliProc = child;
  biliLast = { at: new Date().toISOString(), code: null, running: true, pid: child.pid, max };
  cfg.bili.lastRun = biliLast.at;
  cfg.bili.lastRunDay = localDate();
  saveConfig();

  child.on('exit', (code) => {
    biliProc = null;
    biliLast = { ...biliLast, code, running: false, finishedAt: new Date().toISOString() };
    if (typeof out === 'number') { try { fs.closeSync(out); } catch {} }
    console.log('[console] B站任务结束，exit=' + code);
    scheduleBiliRetry();
  });
  child.on('error', (e) => {
    biliProc = null;
    biliLast = { ...biliLast, code: -1, running: false, error: String(e?.message || e) };
    if (typeof out === 'number') { try { fs.closeSync(out); } catch {} }
  });

  console.log(`[console] B站任务启动，pid=${child.pid} max=${max}（今天 ${today.total}/${dailyMax}）`);
  return { ok: true, pid: child.pid, max, remaining };
}

function checkBiliSchedule() {
  return; // B站已从模拟器删除，自动任务停用；需要时手动打开模拟器进 B站
  if (!cfg.bili?.enabled || biliProc) return;
  const now = new Date();
  const today = localDate(now);

  const t = biliToday();
  const dailyMax = biliDailyMax();

  if (cfg.bili.lastRunDay === today) {
    // 今天已经跑过但没达标（例如控制台中途重启）：续上补跑
    if (t.total < dailyMax && !biliRetryTimer && (biliRetryDay !== today || biliRetryCount < 2)) {
      scheduleBiliRetry();
    }
    return;
  }

  if (t.total >= dailyMax) {
    cfg.bili.lastRunDay = today;
    saveConfig();
    console.log(`[console] B站今天已达 ${t.total}/${dailyMax}，跳过`);
    return;
  }

  const [h, m] = String(cfg.bili.time || '20:00').split(':').map(Number);
  const target = (h || 20) * 60 + (m || 0);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= target) {
    console.log('[console] 到点，启动 B 站每日任务');
    startBiliTask();
  }
}

// ── 长期记忆（memory.json + 人格自动同步） ─────────────────
const COMPANION_CFG = path.join(ROOT, 'packages', 'companion', 'config.json');
const SOCIAL_V2 = path.join(bridgeDir(), 'state', 'social-v2.json');
const PEOPLE_JSON = path.join(ROOT, 'packages', 'companion', 'data', 'people.json');

async function distillMemory() {
  const cfgc = parseJson(fs.readFileSync(COMPANION_CFG, 'utf8'), null);
  if (!cfgc?.apiKey) throw new Error('companion 没有 API key');
  const bridgeCfg = parseJson(fs.readFileSync(bridgeConfigFile(), 'utf8'), {});
  const ownerQQ = String(bridgeCfg.ownerQQ || '');
  const social = parseJson(fs.readFileSync(SOCIAL_V2, 'utf8'), null);
  const conv = social?.conversations?.[`private:${ownerQQ}`] || {};
  const recent = (conv.recentMessages || []).slice(-60)
    .map((m) => `${m.isSelf ? '她' : '用户'}: ${String(m.text || '').replace(/\s+/g, ' ').slice(0, 120)}`)
    .filter((s) => s.length > 4)
    .join('\n');
  const people = parseJson(fs.readFileSync(PEOPLE_JSON, 'utf8'), null);
  const oldTopics = (people?.[ownerQQ]?.topics || []).slice(-30).join('\n');
  const activeTopics = (conv.activeTopics || []).map((t) => t.text).filter(Boolean).join('；');
  const existing = memoryLib.renderSummary();
  const base = String(cfgc.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const user = `从下面的聊天记录里提炼「长期记忆」条目。

只记稳定、可复用、以后有用的：用户的事实（作息/目标/习惯）、偏好、反馈（喜欢/讨厌什么）、关系、明确约定。
不要记：一次性的闲聊、天气、密码/账号/隐私、你自己的情绪表演、已经过期的提醒。
每条 text ≤60 字，一条一件事；不要和已有记忆重复。

分类：facts / preferences / promises / relations / feedback
（promises 只在有明确时间或约定时用；有时就填 dueAt，格式 "YYYY-MM-DD HH:mm"）
- promises：只记「以后还会用到」的约定；时间已经过去的、或只是当天一次性的提醒，不要记。
- feedback：只记用户自己的反应/喜好（他讨厌什么、接受什么、明确说过什么）；不要把你（鱼鱼）说过的话当成反馈。

已有长期记忆（避免重复）：
${existing}

最近 QQ 聊天：
${recent || '（无）'}

她记着的事：${activeTopics || '（无）'}

更早的聊天摘要：
${oldTopics || '（无）'}

输出 JSON（不要代码块），最多 15 条：
{"entries":[{"category":"facts","text":"..."},{"category":"preferences","text":"..."}]}`;
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfgc.apiKey}` },
    body: JSON.stringify({
      model: cfgc.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: '你负责维护一份关于“用户”的长期记忆，只输出 JSON。' },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 1200,
    }),
  });
  if (!r.ok) throw new Error('模型 HTTP ' + r.status);
  const j = await r.json();
  let txt = j?.choices?.[0]?.message?.content || '';
  txt = txt.replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = txt.indexOf('{');
  const e = txt.lastIndexOf('}');
  if (s >= 0 && e > s) txt = txt.slice(s, e + 1);
  const parsed = JSON.parse(txt);
  return memoryLib.mergeEntries(parsed?.entries, { source: 'distill' });
}


const PROC_PS = String.raw`
$ProgressPreference='SilentlyContinue';
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
$items=@();
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  $cmd=[string]$_.CommandLine;
  if ($cmd -match 'index\.mjs' -or $cmd -match 'bridge\.js' -or $cmd -match 'src[\\/]index\.js' -or $cmd -match 'console[\\/]server\.js') {
    $items += [pscustomobject]@{ pid=[int]$_.ProcessId; cmd=$cmd };
  }
};
@($items) | ConvertTo-Json -Compress
`;

let procCache = { at: 0, data: [] };
async function listProcesses(force = false) {
  if (!force && Date.now() - procCache.at < 1500) return procCache.data;
  const r = await ps(PROC_PS);
  let data = parseJson(r.stdout, []);
  if (!Array.isArray(data)) data = data ? [data] : [];
  procCache = { at: Date.now(), data };
  return data;
}

function classify(procs) {
  const snow = procs.filter((p) => /index\.mjs/.test(p.cmd));
  const bridge = procs.filter((p) => /src[\\/]bridge\.js/.test(p.cmd));
  const legacy = procs.filter((p) => /src[\\/]index\.js/.test(p.cmd));
  return { snow, bridge, legacy };
}

async function killPid(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function stopMatches(re) {
  const procs = await listProcesses(true);
  const hits = procs.filter((p) => re.test(p.cmd));
  const pids = [...new Set(hits.map((p) => p.pid))];
  for (const pid of pids) await killPid(pid);
  procCache.at = 0;
  return pids;
}

function spawnDetached(exe, args, cwd, logFile) {
  let fd = null;
  if (logFile) {
    fd = fs.openSync(logFile, 'a');
    try { fs.writeSync(fd, `\n\n===== ${new Date().toISOString()} start ${exe} ${args.join(' ')} =====\n`); } catch {}
  }
  const child = spawn(exe, args, {
    cwd,
    detached: true,
    windowsHide: true,
    stdio: fd ? ['ignore', fd, fd] : 'ignore',
  });
  child.unref();
  if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  return child.pid;
}

async function waitPort(port, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const open = await portOpen(port);
    if (open === want) return true;
    await sleep(500);
  }
  return false;
}

// ── DSH 发现 ──────────────────────────────────────────────────
const DSH_PS = String.raw`
$ProgressPreference='SilentlyContinue';
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
$p = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object { $_.CommandLine -match 'dsh-desktop-host' } | Select-Object -First 1;
if (-not $p) { '{"running":false}' } else {
  $ports = @(Get-NetTCPConnection -OwningProcess $p.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique);
  [pscustomobject]@{ running=$true; pid=[int]$p.ProcessId; ports=@($ports) } | ConvertTo-Json -Compress
}
`;
let dshCache = { at: 0, data: { running: false, pid: null, baseUrl: '' } };
async function discoverDsh(force = false) {
  if (!force && Date.now() - dshCache.at < 1500) return dshCache.data;
  const r = await ps(DSH_PS);
  const raw = parseJson(r.stdout, { running: false });
  const data = { running: !!raw.running, pid: raw.pid || null, baseUrl: '' };
  if (data.running && Array.isArray(raw.ports)) {
    for (const port of raw.ports) {
      const url = `http://127.0.0.1:${port}`;
      try {
        const res = await fetch(url + '/api/version', { signal: AbortSignal.timeout(1200) });
        if (res.status === 200 || res.status === 401 || res.status === 404) { data.baseUrl = url; break; }
      } catch {}
    }
  }
  dshCache = { at: Date.now(), data };
  return data;
}

// ── qq-bridge / SnowLuma 配置 ─────────────────────────────────
function bridgeDir() {
  const d = String(cfg.qqbridge?.dir || 'qq-bridge');
  return path.isAbsolute(d) ? d : path.resolve(ROOT, d);
}
function bridgeConfigFile() { return path.join(bridgeDir(), 'config.json'); }
function readBridgeConfig() {
  try { return JSON.parse(fs.readFileSync(bridgeConfigFile(), 'utf8')); } catch { return {}; }
}
function writeBridgeConfig(obj) {
  fs.mkdirSync(bridgeDir(), { recursive: true });
  fs.writeFileSync(bridgeConfigFile(), JSON.stringify(obj, null, 2), 'utf8');
}

function readStateJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(bridgeDir(), 'state', name), 'utf8')); } catch { return fallback; }
}
function currentModeLocal() { return readStateJson('mode.json', {}).mode || 'reserved2'; }
function currentRoleLocal() { return readStateJson('current-role.json', {}).role || null; }

function readSnowlumaConfig() {
  try {
    const dir = path.join(cfg.snowluma.dir, 'config');
    const files = fs.readdirSync(dir).filter((f) => /^onebot_.+\.json$/.test(f));
    if (!files.length) return null;
    // 优先选与 qq-bridge 配置里 HTTP token 一致的那份（防止多账号时抓错人）
    const want = String(readBridgeConfig()?.snowluma?.accessToken || '');
    let file = '';
    if (want) {
      for (const f of files) {
        try {
          const jj = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (String(jj?.networks?.httpServers?.[0]?.accessToken || '') === want) { file = f; break; }
        } catch {}
      }
    }
    if (!file) {
      files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
      file = files[0];
    }
    const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const http = j.networks?.httpServers?.[0] || {};
    const ws = j.networks?.wsServers?.[0] || {};
    let webuiPort = 5099;
    try {
      const rt = JSON.parse(fs.readFileSync(path.join(dir, 'runtime.json'), 'utf8'));
      webuiPort = Number(rt.webuiPort) || 5099;
    } catch {}
    return {
      uin: file.replace(/^onebot_/, '').replace(/\.json$/, ''),
      httpPort: Number(http.port) || 3000,
      wsPort: Number(ws.port) || 3001,
      httpToken: String(http.accessToken || ''),
      wsToken: String(ws.accessToken || ''),
      webuiPort,
    };
  } catch { return null; }
}

async function snowlumaOnline(sl) {
  if (!sl?.httpToken) return { online: null, good: null };
  try {
    const res = await fetch(`http://127.0.0.1:${sl.httpPort}/get_status`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sl.httpToken}`, 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(2500),
    });
    const j = await res.json();
    return { online: !!j?.data?.online, good: !!j?.data?.good };
  } catch { return { online: null, good: null }; }
}

async function bridgeApi(method, pathname, body) {
  const bc = readBridgeConfig();
  const token = String(bc.consoleToken || '');
  if (!token) throw new Error('qq-bridge 没有 consoleToken');
  const res = await fetch(`http://127.0.0.1:3100${pathname}`, {
    method,
    headers: { 'x-console-token': token, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return j;
}

// ── 操作状态 ──────────────────────────────────────────────────
let op = { name: null, step: '', startedAt: 0, finishedAt: 0, error: null };
function beginOp(name) {
  if (op.name && !op.finishedAt) return false;
  op = { name, step: '准备中', startedAt: Date.now(), finishedAt: 0, error: null };
  return true;
}
async function runOp(name, fn) {
  if (!beginOp(name)) return false;
  try {
    await fn();
    op.step = '完成';
    op.finishedAt = Date.now();
  } catch (e) {
    op.error = String(e?.message || e);
    op.step = '失败';
    op.finishedAt = Date.now();
  }
  return true;
}

// ── 启停 ──────────────────────────────────────────────────────
async function ensureDsh() {
  let d = await discoverDsh(true);
  if (d.running) return d;
  if (!cfg.autoStartDsh) throw new Error('DSH 没有运行，且设置里关闭了自动启动');
  const exe = cfg.dsh.exe;
  if (!fs.existsSync(exe)) throw new Error(`找不到 DSH：${exe}`);
  op.step = '启动 DSH…';
  spawnDetached(exe, [], path.dirname(exe), null);
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    d = await discoverDsh(true);
    if (d.baseUrl) return d;
  }
  throw new Error('DSH 启动超时（90 秒）');
}

async function ensureSnowluma() {
  if (await portOpen(5099)) return;
  const dir = cfg.snowluma.dir;
  if (!fs.existsSync(path.join(dir, 'index.mjs'))) throw new Error(`SnowLuma 目录不对：${dir}`);
  op.step = '启动 SnowLuma…';
  spawnDetached(process.execPath, ['index.mjs'], dir, path.join(LOG_DIR, 'snowluma.log'));
  if (!(await waitPort(5099, true, 60000))) throw new Error('SnowLuma 启动超时（60 秒）');
}

async function ensureBridge(dsh) {
  if (await portOpen(3100)) return;
  const dir = bridgeDir();
  if (!fs.existsSync(path.join(dir, 'src', 'bridge.js'))) throw new Error(`qq-bridge 目录不对：${dir}`);
  const bc = readBridgeConfig();
  if (dsh?.baseUrl && bc.dsh) {
    bc.dsh.baseUrl = dsh.baseUrl;
    writeBridgeConfig(bc);
  }
  op.step = '启动 qq-bridge…';
  spawnDetached(process.execPath, ['src/bridge.js'], dir, path.join(LOG_DIR, 'bridge.log'));
  if (!(await waitPort(3100, true, 45000))) throw new Error('qq-bridge 启动超时（45 秒）');
}

async function startAll() {
  try {
    await ensureEmulator();
  } catch (e) {
    console.warn('[console] emulator:', e?.message || e);
  }
  const dsh = await ensureDsh();
  op.step = '同步 DSH 地址…';
  const bc = readBridgeConfig();
  if (dsh.baseUrl && bc.dsh && bc.dsh.baseUrl !== dsh.baseUrl) {
    bc.dsh.baseUrl = dsh.baseUrl;
    writeBridgeConfig(bc);
  }
  await ensureSnowluma();
  // 不阻塞等待 QQ 登录：qq-bridge 会自己重连一整天
  op.step = '等待 OneBot（QQ 登录后自动就绪）…';
  await ensureBridge(dsh);
  op.step = '全部就绪';
}

async function stopAll() {
  op.step = '停止 qq-bridge…';
  await stopMatches(/src[\\/]bridge\.js/);
  await waitPort(3100, false, 8000);
  op.step = '停止 SnowLuma…';
  await stopMatches(/index\.mjs/);
  await waitPort(5099, false, 10000);
  op.step = '已停止';
}

async function restartBridge() {
  const dsh = await discoverDsh(true);
  op.step = '停止 qq-bridge…';
  await stopMatches(/src[\\/]bridge\.js/);
  await waitPort(3100, false, 8000);
  await ensureBridge(dsh);
  op.step = 'qq-bridge 已重启';
}

// ── 状态 ──────────────────────────────────────────────────────
async function buildStatus() {
  const [dsh, procs, p5099, p3000, p3001, p3100, mumu] = await Promise.all([
    discoverDsh(),
    listProcesses(),
    portOpen(5099),
    portOpen(3000),
    portOpen(3001),
    portOpen(3100),
    mumuInfo(),
  ]);
  const cls = classify(procs);
  const sl = readSnowlumaConfig();
  const [online, bridgeStatus] = await Promise.all([
    p3000 ? snowlumaOnline(sl) : Promise.resolve({ online: null, good: null }),
    p3100 ? bridgeApi('GET', '/api/status').catch(() => null) : Promise.resolve(null),
  ]);
  let mode = null;
  let role = null;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(bridgeDir(), 'state', 'mode.json'), 'utf8'));
    mode = st.mode || null;
  } catch {}
  try {
    const st = JSON.parse(fs.readFileSync(path.join(bridgeDir(), 'state', 'current-role.json'), 'utf8'));
    role = st.role || null;
  } catch {}
  return {
    time: Date.now(),
    gui: { port: cfg.port, autostart: fs.existsSync(startupShortcut()), autoStart: !!cfg.autoStart },
    dsh: { running: dsh.running, pid: dsh.pid, baseUrl: dsh.baseUrl || cfg.dsh.baseUrl || '' },
    snowluma: {
      running: p5099 || cls.snow.length > 0,
      port: 5099,
      uin: sl?.uin || null,
      online: online.online,
      good: online.good,
      webuiPort: sl?.webuiPort || 5099,
      httpPort: sl?.httpPort || 3000,
      wsPort: sl?.wsPort || 3001,
    },
    onebot: { http: p3000, ws: p3001 },
    bridge: {
      running: p3100 || cls.bridge.length > 0,
      pid: cls.bridge[0]?.pid || null,
      consolePort: 3100,
      mode: bridgeStatus?.mode || mode,
      role: bridgeStatus?.role ?? role,
      dshReady: bridgeStatus?.dshReady ?? null,
      snowluma: bridgeStatus?.snowluma || null,
      activity: bridgeStatus?.activity || '',
      paused: bridgeStatus?.socialV2Paused ?? null,
    },
    legacy: cls.legacy.map((p) => ({ pid: p.pid, cmd: p.cmd })),
    emulator: {
      running: !!mumu?.is_process_started,
      androidStarted: !!mumu?.is_android_started,
      name: mumu?.name || '',
      adbPort: mumu?.adb_port || null,
      serial: cfg.mumu.serial,
    },
    op,
  };
}

// ── 设置 ──────────────────────────────────────────────────────
function getSettings() {
  const bc = readBridgeConfig();
  const sl = readSnowlumaConfig();
  return {
    autostart: fs.existsSync(startupShortcut()),
    gui: {
      port: cfg.port,
      autoStart: !!cfg.autoStart,
      autoStartDsh: !!cfg.autoStartDsh,
      dshExe: cfg.dsh.exe,
      dshBaseUrl: cfg.dsh.baseUrl || '',
      snowDir: cfg.snowluma.dir,
      bridgeDir: bridgeDir(),
    },
    bridge: {
      dshBaseUrl: bc.dsh?.baseUrl || '',
      model: bc.dsh?.model || 'deepseek-flash',
      reasoningEffort: bc.dsh?.reasoningEffort || 'max',
      agentPreset: bc.agentPreset || 'qq-chat',
      socialV2AgentPreset: bc.socialV2?.agentPreset || 'qq-chat-v2',
      ownerQQ: bc.ownerQQ || '',
      allowPrivate: (bc.allow?.private || []).join(', '),
      allowGroups: (bc.allow?.groups || []).join(', '),
      allowAllWhenEmpty: !!bc.allowAllWhenEmpty,
      sendDelayMs: Number(bc.sendDelayMs ?? 800),
      maxSendPerMinute: Number(bc.socialV2?.send?.maxSendPerMinute ?? 6),
      maxSendPerHour: Number(bc.socialV2?.send?.maxSendPerHour ?? 80),
      maxMessageChars: Number(bc.socialV2?.send?.maxMessageChars ?? 500),
      maxReplyChars: Number(bc.social?.maxReplyChars ?? 500),
      proactive: bc.socialV2?.proactive?.enabled !== false,
      roleMaxInjectChars: Number(bc.role?.maxInjectChars ?? 8000),
      consoleToken: String(bc.consoleToken || ''),
      mode: currentModeLocal(),
      role: currentRoleLocal(),
    },
    snowluma: sl,
    mumu: {
      manager: cfg.mumu.manager,
      adb: cfg.mumu.adb,
      instance: cfg.mumu.instance,
      serial: cfg.mumu.serial,
      autoStart: !!cfg.mumu.autoStart,
    },
  };
}

function parseIdList(s) {
  return String(s || '').split(/[\s,，;；]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
}

async function applySettings(body) {
  let restartRequired = false;
  const gui = body.gui || {};
  const br = body.bridge || {};
  const mu = body.mumu || {};

  const nextCfg = structuredClone(cfg);
  if (gui.autoStart !== undefined) nextCfg.autoStart = !!gui.autoStart;
  if (gui.autoStartDsh !== undefined) nextCfg.autoStartDsh = !!gui.autoStartDsh;
  if (typeof gui.dshExe === 'string' && gui.dshExe.trim()) nextCfg.dsh.exe = gui.dshExe.trim();
  if (typeof gui.dshBaseUrl === 'string') nextCfg.dsh.baseUrl = gui.dshBaseUrl.trim();
  if (typeof gui.snowDir === 'string' && gui.snowDir.trim()) nextCfg.snowluma.dir = gui.snowDir.trim();
  if (typeof gui.bridgeDir === 'string' && gui.bridgeDir.trim()) nextCfg.qqbridge.dir = gui.bridgeDir.trim();
  if (!nextCfg.mumu) nextCfg.mumu = {};
  if (typeof mu.manager === 'string' && mu.manager.trim()) nextCfg.mumu.manager = mu.manager.trim();
  if (typeof mu.adb === 'string' && mu.adb.trim()) nextCfg.mumu.adb = mu.adb.trim();
  if (mu.instance !== undefined) nextCfg.mumu.instance = Math.max(0, Number(mu.instance) || 0);
  if (typeof mu.serial === 'string' && mu.serial.trim()) nextCfg.mumu.serial = mu.serial.trim();
  if (mu.autoStart !== undefined) nextCfg.mumu.autoStart = !!mu.autoStart;
  cfg = nextCfg;
  saveConfig();

  const bc = readBridgeConfig();
  if (!bc.dsh) bc.dsh = {};
  if (!bc.allow) bc.allow = { private: [], groups: [] };
  if (!bc.socialV2) bc.socialV2 = {};
  if (!bc.socialV2.send) bc.socialV2.send = {};
  if (!bc.socialV2.proactive) bc.socialV2.proactive = {};
  if (!bc.social) bc.social = {};
  if (!bc.role) bc.role = {};

  if (typeof br.model === 'string' && br.model.trim()) bc.dsh.model = br.model.trim();
  if (typeof br.reasoningEffort === 'string' && br.reasoningEffort.trim()) bc.dsh.reasoningEffort = br.reasoningEffort.trim();
  if (typeof br.agentPreset === 'string' && br.agentPreset.trim()) bc.agentPreset = br.agentPreset.trim();
  if (typeof br.socialV2AgentPreset === 'string' && br.socialV2AgentPreset.trim()) bc.socialV2.agentPreset = br.socialV2AgentPreset.trim();
  if (br.ownerQQ !== undefined && String(br.ownerQQ).trim()) bc.ownerQQ = Number(String(br.ownerQQ).trim()) || bc.ownerQQ;
  if (br.allowPrivate !== undefined) bc.allow.private = parseIdList(br.allowPrivate);
  if (br.allowGroups !== undefined) bc.allow.groups = parseIdList(br.allowGroups);
  if (br.allowAllWhenEmpty !== undefined) bc.allowAllWhenEmpty = !!br.allowAllWhenEmpty;
  if (br.sendDelayMs !== undefined) bc.sendDelayMs = Math.max(0, Number(br.sendDelayMs) || 0);
  if (br.maxSendPerMinute !== undefined) bc.socialV2.send.maxSendPerMinute = Math.max(1, Number(br.maxSendPerMinute) || 1);
  if (br.maxSendPerHour !== undefined) bc.socialV2.send.maxSendPerHour = Math.max(1, Number(br.maxSendPerHour) || 1);
  if (br.maxMessageChars !== undefined) bc.socialV2.send.maxMessageChars = Math.max(50, Number(br.maxMessageChars) || 500);
  if (br.maxReplyChars !== undefined) bc.social.maxReplyChars = Math.max(50, Number(br.maxReplyChars) || 500);
  if (br.proactive !== undefined) bc.socialV2.proactive.enabled = !!br.proactive;
  if (br.roleMaxInjectChars !== undefined) bc.role.maxInjectChars = Math.min(20000, Math.max(1000, Number(br.roleMaxInjectChars) || 8000));
  if (typeof br.consoleToken === 'string' && br.consoleToken.trim()) bc.consoleToken = br.consoleToken.trim();
  if (br.rotateConsoleToken) bc.consoleToken = cryptoRandomHex(16);

  const sl = readSnowlumaConfig();
  if (sl && bc.snowluma) {
    bc.snowluma.wsUrl = `ws://127.0.0.1:${sl.wsPort}`;
    bc.snowluma.httpUrl = `http://127.0.0.1:${sl.httpPort}`;
    bc.snowluma.accessToken = sl.httpToken;
    bc.snowluma.homeDir = cfg.snowluma.dir;
    bc.snowluma.launcherPath = path.join(cfg.snowluma.dir, 'launcher.bat');
  }
  writeBridgeConfig(bc);
  restartRequired = true;

  if (typeof br.mode === 'string' && ['chat', 'closed-agent', 'reserved', 'reserved2'].includes(br.mode)) {
    if (await portOpen(3100)) {
      bridgeApi('POST', '/api/mode', { mode: br.mode }).catch(() => {});
    } else {
      try {
        fs.mkdirSync(path.join(bridgeDir(), 'state'), { recursive: true });
        fs.writeFileSync(path.join(bridgeDir(), 'state', 'mode.json'), JSON.stringify({ mode: br.mode }, null, 2), 'utf8');
      } catch {}
    }
  }
  return { restartRequired };
}

function cryptoRandomHex(bytes) {
  return [...Array(bytes)].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
}

// ── 人格 ──────────────────────────────────────────────────────
function roleDir() { return path.join(bridgeDir(), 'roles'); }
function safeRoleName(name) {
  return String(name || '').trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '').slice(0, 40);
}
function listRolesLocal() {
  try {
    const files = fs.readdirSync(roleDir()).filter((f) => f.endsWith('.md') && f !== 'README.md');
    const current = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(bridgeDir(), 'state', 'current-role.json'), 'utf8')).role || null; } catch { return null; }
    })();
    return {
      ok: true,
      roles: files.map((f) => f.replace(/\.md$/, '')),
      summaries: files.map((f) => ({
        name: f.replace(/\.md$/, ''),
        chars: fs.readFileSync(path.join(roleDir(), f), 'utf8').length,
        current: f.replace(/\.md$/, '') === current,
      })),
      current,
    };
  } catch { return { ok: true, roles: [], summaries: [], current: null }; }
}

// ── 日志 ──────────────────────────────────────────────────────
function tailFile(file, lines = 200, maxBytes = 512 * 1024) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch { return ''; }
}
function snowlumaLogFile() {
  try {
    const dir = path.join(cfg.snowluma.dir, 'logs');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => ({
      f, t: fs.statSync(path.join(dir, f)).mtimeMs,
    })).sort((a, b) => b.t - a.t);
    return files[0] ? path.join(dir, files[0].f) : '';
  } catch { return ''; }
}

// ── 开机自启 ──────────────────────────────────────────────────
function startupShortcut() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', '小鲸鱼控制台.lnk');
}
function vbsPath() { return path.join(__dirname, 'start-console.vbs'); }
async function setAutostart(enabled) {
  const lnk = startupShortcut();
  if (!enabled) {
    try { fs.rmSync(lnk, { force: true }); } catch {}
    return false;
  }
  const script = String.raw`
$ws = New-Object -ComObject WScript.Shell;
$s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}');
$s.TargetPath = "$env:WINDIR\System32\wscript.exe";
$s.Arguments = '"${vbsPath().replace(/"/g, '""')}"';
$s.WorkingDirectory = '${__dirname.replace(/'/g, "''")}';
$s.WindowStyle = 7;
$s.Description = '小鲸鱼控制台';
$s.Save();
`;
  const r = await ps(script, 15000);
  if (r.err) throw new Error(r.stderr || r.err.message);
  return fs.existsSync(lnk);
}

// ── HTTP ──────────────────────────────────────────────────────
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '').toLowerCase();
    const allowed = [`127.0.0.1:${cfg.port}`, `localhost:${cfg.port}`];
    if (!allowed.includes(host)) return json(res, 403, { ok: false, error: '只接受本机回环访问' });

    const url = new URL(req.url, `http://127.0.0.1:${cfg.port}`);
    const p = url.pathname;

    if (!p.startsWith('/api/')) {
      let file = p === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, p.replace(/^\/+/, ''));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(PUBLIC, 'index.html');
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/ping' && req.method === 'GET') return json(res, 200, { ok: true, app: 'whale-console', port: cfg.port });

    if (p === '/api/status' && req.method === 'GET') {
      const st = await buildStatus();
      return json(res, 200, { ok: true, status: st });
    }

    if (p === '/api/settings' && req.method === 'GET') return json(res, 200, { ok: true, settings: getSettings() });

    if (p === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const r = await applySettings(body);
      return json(res, 200, { ok: true, ...r });
    }

    if (p === '/api/start' && req.method === 'POST') {
      void runOp('start', startAll);
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/stop' && req.method === 'POST') {
      void runOp('stop', stopAll);
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/restart' && req.method === 'POST') {
      void runOp('restart', restartBridge);
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/start/snowluma' && req.method === 'POST') {
      void runOp('snowluma', async () => { op.step = '启动 SnowLuma…'; await ensureSnowluma(); });
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/stop/snowluma' && req.method === 'POST') {
      void runOp('snowluma-stop', async () => { op.step = '停止 SnowLuma…'; await stopMatches(/index\.mjs/); });
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/start/bridge' && req.method === 'POST') {
      void runOp('bridge', async () => { const d = await discoverDsh(true); await ensureBridge(d); });
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/stop/bridge' && req.method === 'POST') {
      void runOp('bridge-stop', async () => { op.step = '停止 qq-bridge…'; await stopMatches(/src[\\/]bridge\.js/); });
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/stop/legacy' && req.method === 'POST') {
      void runOp('legacy-stop', async () => { op.step = '停止旧 companion…'; await stopMatches(/src[\\/]index\.js/); });
      return json(res, 200, { ok: true, accepted: true });
    }

    if (p === '/api/logs' && req.method === 'GET') {
      const source = String(url.searchParams.get('source') || 'bridge');
      const lines = Math.min(500, Math.max(20, Number(url.searchParams.get('lines') || 200)));
      let file = '';
      if (source === 'bridge') file = path.join(LOG_DIR, 'bridge.log');
      else if (source === 'snowluma') file = snowlumaLogFile();
      else if (source === 'console') file = path.join(LOG_DIR, 'console.log');
      const text = file ? tailFile(file, lines) : '';
      return json(res, 200, { ok: true, source, file, text });
    }

    if (p === '/api/phone/status' && req.method === 'GET') {
      try { return json(res, 200, { ok: true, phone: await phoneStatus() }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/phone/start' && req.method === 'POST') {
      void runOp('phone-start', async () => { op.step = '启动模拟器…'; await mumuStart(); });
      return json(res, 200, { ok: true, accepted: true });
    }
    if (p === '/api/phone/connect' && req.method === 'POST') {
      const r = await mumuConnect();
      return json(res, 200, { ok: r.ok, output: String(r.stdout || '').trim(), error: String(r.stderr || '').trim() });
    }
    if (p === '/api/phone/screenshot' && req.method === 'POST') {
      try {
        const file = await mumuScreenshot();
        return json(res, 200, { ok: true, file, url: '/api/phone/shot?t=' + Date.now() });
      } catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/phone/shot' && req.method === 'GET') {
      const file = path.join(LOG_DIR, 'phone.png');
      if (!fs.existsSync(file)) return json(res, 404, { ok: false, error: '还没有截图' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === '/api/phone/apps' && req.method === 'GET') {
      try { return json(res, 200, { ok: true, apps: await mumuApps() }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/phone/open' && req.method === 'POST') {
      const body = await readBody(req);
      const pkg = String(body.pkg || '').trim();
      if (!pkg) return json(res, 400, { ok: false, error: '缺少 pkg' });
      try { const output = await mumuOpenApp(pkg); return json(res, 200, { ok: true, output }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/phone/keyboard' && req.method === 'POST') {
      try { const output = await mumuInstallKeyboard(); return json(res, 200, { ok: true, output }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }

    if (p === '/api/bili/status' && req.method === 'GET') {
      return json(res, 200, { ok: true, bili: biliStatus() });
    }
    if (p === '/api/bili/run' && req.method === 'POST') {
      const r = startBiliTask();
      return json(res, r.ok ? 200 : 409, r);
    }
    if (p === '/api/bili/config' && req.method === 'POST') {
      const body = await readBody(req);
      const next = structuredClone(cfg);
      if (!next.bili) next.bili = {};
      if (body.enabled !== undefined) next.bili.enabled = !!body.enabled;
      if (typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time)) next.bili.time = body.time;
      if (body.max !== undefined) next.bili.max = Math.max(3, Math.min(7, Number(body.max) || 5));
      cfg = next;
      saveConfig();
      return json(res, 200, { ok: true, bili: biliStatus() });
    }
    if (p === '/api/bili/history' && req.method === 'GET') {
      return json(res, 200, { ok: true, history: readBiliHistory(50) });
    }
    if (p === '/api/bili/log' && req.method === 'GET') {
      const file = path.join(LOG_DIR, 'bili-task.log');
      return json(res, 200, { ok: true, text: fs.existsSync(file) ? tailFile(file, 100) : '' });
    }

    // ── 长期记忆 ────────────────────────────────────────────
    if (p === '/api/memory' && req.method === 'GET') {
      const memory = memoryLib.loadMemory();
      return json(res, 200, {
        ok: true, memory, summary: memoryLib.renderSummary(),
        counts: memoryLib.counts(), file: memoryLib.MEMORY_FILE,
      });
    }
    if (p === '/api/memory/add' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const r = memoryLib.addEntry(String(body.category || 'facts'), String(body.text || ''), {
          source: 'console', target: body.target, dueAt: body.dueAt,
        });
        return json(res, 200, { ok: true, ...r, counts: memoryLib.counts() });
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e?.message || e) });
      }
    }
    if (p === '/api/memory/remove' && req.method === 'POST') {
      const body = await readBody(req);
      const r = memoryLib.removeEntry(String(body.id || body.text || ''));
      return json(res, r.ok ? 200 : 404, r);
    }
    if (p === '/api/memory/update' && req.method === 'POST') {
      const body = await readBody(req);
      const r = memoryLib.updateEntry(String(body.id || ''), body);
      return json(res, r.ok ? 200 : 404, r);
    }
    if (p === '/api/memory/distill' && req.method === 'POST') {
      try {
        const added = await distillMemory();
        return json(res, 200, { ok: true, added, counts: memoryLib.counts() });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e) });
      }
    }
    if (p === '/api/memory/import' && req.method === 'POST') {
      const body = await readBody(req);
      const raw = typeof body.json === 'string'
        ? (() => { try { return JSON.parse(body.json); } catch { return null; } })()
        : body.json;
      if (!raw || typeof raw !== 'object') return json(res, 400, { ok: false, error: 'JSON 不合法' });
      const m = memoryLib.normalize(raw);
      if (body.replace) {
        memoryLib.saveMemory(m);
        memoryLib.syncRoleBlock();
      } else {
        for (const c of memoryLib.CATEGORIES) {
          for (const e of m[c]) {
            try { memoryLib.addEntry(c, e.text, { source: 'import', target: e.target, dueAt: e.dueAt }); } catch {}
          }
        }
      }
      return json(res, 200, { ok: true, counts: memoryLib.counts() });
    }
    if (p === '/api/memory/export' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="memory.json"',
      });
      return res.end(JSON.stringify(memoryLib.loadMemory(), null, 2));
    }

    // ── 授权应用 / 桌面控制 ────────────────────────────────
    if (p === '/api/apps' && req.method === 'GET') {
      let running = [];
      let runningError = '';
      try { running = await desktopLib.listRunning(); } catch (e) { runningError = String(e?.message || e); }
      return json(res, 200, { ok: true, apps: desktopLib.listApps(), running, runningError });
    }
    if (p === '/api/apps/running' && req.method === 'GET') {
      try { return json(res, 200, { ok: true, items: await desktopLib.listRunning() }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/installed' && req.method === 'GET') {
      try { return json(res, 200, { ok: true, items: await desktopLib.scanInstalled() }); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/pick-exe' && req.method === 'POST') {
      try { return json(res, 200, await desktopLib.pickExe()); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/inspect' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        return json(res, 200, { ok: true, ...(await desktopLib.inspectExe(String(body.exe || ''))) });
      } catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/add' && req.method === 'POST') {
      const body = await readBody(req);
      try { return json(res, 200, { ok: true, app: desktopLib.addApp(body) }); }
      catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/remove' && req.method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, { ok: true, removed: desktopLib.removeApp(String(body.id || '')) });
    }
    if (p === '/api/apps/toggle' && req.method === 'POST') {
      const body = await readBody(req);
      const app = desktopLib.toggleApp(String(body.id || ''), !!body.enabled);
      return app ? json(res, 200, { ok: true, app }) : json(res, 404, { ok: false, error: '应用不存在' });
    }
    if (p === '/api/apps/launch' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const app = desktopLib.requireApp(String(body.id || ''), 'launch');
        const r = await desktopLib.launch(app);
        return json(res, 200, { ok: r.ok, app, window: r.window, error: r.error });
      } catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/snapshot' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const app = desktopLib.requireApp(String(body.id || ''), 'snapshot');
        const r = app.screen ? await desktopLib.screenSnapshot() : await desktopLib.snapshot(app);
        if (!r.ok) return json(res, 500, { ok: false, error: r.error || '截图失败' });
        return json(res, 200, {
          ok: true, app, window: r.window, width: r.width, height: r.height, path: r.path,
          url: `/api/apps/shot?id=${encodeURIComponent(app.id)}&t=${Date.now()}`,
        });
      } catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/apps/shot' && req.method === 'GET') {
      const id = String(url.searchParams.get('id') || '');
      const app = desktopLib.getApp(id);
      if (!app) return json(res, 404, { ok: false, error: '应用不存在' });
      const file = path.join(LOG_DIR, `app-${app.id}.png`);
      if (!fs.existsSync(file)) return json(res, 404, { ok: false, error: '还没有截图' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }

    // ── 授权文件夹 / 文档 ─────────────────────────────────
    if (p === '/api/files' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        roots: fileLib.listRoots(),
        cfg: fileLib.FILES_CFG,
        unrestricted: fileLib.isUnrestricted(),
        home: fileLib.HOME,
      });
    }
    if (p === '/api/files/list' && req.method === 'GET') {
      try { return json(res, 200, { ok: true, ...fileLib.listDir(String(url.searchParams.get('path') || '')) }); }
      catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/files/read' && req.method === 'GET') {
      try {
        const r = await fileLib.preview(String(url.searchParams.get('path') || ''));
        return json(res, 200, { ok: true, ...r });
      } catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/files/root/add' && req.method === 'POST') {
      const body = await readBody(req);
      try { return json(res, 200, { ok: true, ...fileLib.addRoot(String(body.path || '')) }); }
      catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/files/root/remove' && req.method === 'POST') {
      const body = await readBody(req);
      try { return json(res, 200, { ok: true, roots: fileLib.removeRoot(String(body.path || '')) }); }
      catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/files/pick-folder' && req.method === 'POST') {
      try { return json(res, 200, await desktopLib.pickFolder()); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/files/send-qq' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const r = await fileLib.sendQQFile(String(body.path || ''), body.name);
        return json(res, 200, { ok: true, ...r });
      } catch (e) { return json(res, 400, { ok: false, error: String(e?.message || e) }); }
    }

    // ── 实时感知 ───────────────────────────────────────────
    if (p === '/api/perception' && req.method === 'GET') {
      const r = perceptionLib.read();
      return json(res, 200, { ok: true, status: r.status, transcript: r.transcript, hasImage: !!r.latest });
    }
    if (p === '/api/perception/start' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const r = await perceptionLib.start({ mode: String(body.mode || 'pc'), seconds: Number(body.seconds) || 0 });
        return json(res, r.ok ? 200 : 500, r);
      } catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/perception/stop' && req.method === 'POST') {
      try { return json(res, 200, await perceptionLib.stop()); }
      catch (e) { return json(res, 500, { ok: false, error: String(e?.message || e) }); }
    }
    if (p === '/api/perception/latest.jpg' && req.method === 'GET') {
      const file = perceptionLib.LATEST;
      if (!fs.existsSync(file)) return json(res, 404, { ok: false, error: '还没有画面' });
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }

    if (p === '/api/roles' && req.method === 'GET') {
      if (await portOpen(3100)) {
        try { return json(res, 200, await bridgeApi('GET', '/api/roles')); } catch {}
      }
      return json(res, 200, listRolesLocal());
    }
    if (p === '/api/roles/content' && req.method === 'GET') {
      const name = safeRoleName(url.searchParams.get('name'));
      if (!name) return json(res, 400, { ok: false, error: '缺少 name' });
      if (await portOpen(3100)) {
        try { return json(res, 200, await bridgeApi('GET', `/api/roles/content?name=${encodeURIComponent(name)}`)); } catch {}
      }
      try {
        const content = fs.readFileSync(path.join(roleDir(), name + '.md'), 'utf8');
        return json(res, 200, { ok: true, name, content, chars: content.length });
      } catch { return json(res, 404, { ok: false, error: '人格不存在' }); }
    }
    if (p === '/api/roles/save' && req.method === 'POST') {
      const body = await readBody(req);
      const name = safeRoleName(body.name);
      if (!name) return json(res, 400, { ok: false, error: '人格名不合法' });
      const content = String(body.content || '');
      if (await portOpen(3100)) {
        try {
          const exists = (() => { try { return fs.existsSync(path.join(roleDir(), name + '.md')); } catch { return false; } })();
          const r = await bridgeApi('POST', exists ? '/api/roles/update' : '/api/roles/create', { name, content });
          if (body.activate) await bridgeApi('POST', '/api/role', { role: name });
          try { memoryLib.syncRoleBlock(); } catch {}
          return json(res, 200, r);
        } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      try {
        fs.mkdirSync(roleDir(), { recursive: true });
        fs.writeFileSync(path.join(roleDir(), name + '.md'), content, 'utf8');
        if (body.activate) fs.writeFileSync(path.join(bridgeDir(), 'state', 'current-role.json'), JSON.stringify({ role: name }, null, 2), 'utf8');
        try { memoryLib.syncRoleBlock(); } catch {}
        return json(res, 200, { ok: true, name, chars: content.length });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }
    if (p === '/api/roles/activate' && req.method === 'POST') {
      const body = await readBody(req);
      const name = safeRoleName(body.name);
      if (await portOpen(3100)) {
        try {
          const r = await bridgeApi('POST', '/api/role', name ? { role: name } : {});
          try { memoryLib.syncRoleBlock(); } catch {}
          return json(res, 200, r);
        } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      try {
        fs.writeFileSync(path.join(bridgeDir(), 'state', 'current-role.json'), JSON.stringify({ role: name || null }, null, 2), 'utf8');
        try { memoryLib.syncRoleBlock(); } catch {}
        return json(res, 200, { ok: true, role: name || null });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }
    if (p === '/api/roles/delete' && req.method === 'POST') {
      const body = await readBody(req);
      const name = safeRoleName(body.name);
      if (await portOpen(3100)) {
        try { return json(res, 200, await bridgeApi('POST', '/api/roles/delete', { name })); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      try { fs.rmSync(path.join(roleDir(), name + '.md'), { force: true }); return json(res, 200, { ok: true }); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }
    if (p === '/api/mode' && req.method === 'POST') {
      const body = await readBody(req);
      const mode = String(body.mode || '');
      if (!['chat', 'closed-agent', 'reserved', 'reserved2'].includes(mode)) return json(res, 400, { ok: false, error: 'mode 不合法' });
      if (await portOpen(3100)) {
        try { return json(res, 200, await bridgeApi('POST', '/api/mode', { mode })); } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
      }
      try {
        fs.mkdirSync(path.join(bridgeDir(), 'state'), { recursive: true });
        fs.writeFileSync(path.join(bridgeDir(), 'state', 'mode.json'), JSON.stringify({ mode }, null, 2), 'utf8');
        return json(res, 200, { ok: true, mode, localOnly: true });
      } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
    }

    if (p === '/api/autostart' && req.method === 'GET') return json(res, 200, { ok: true, enabled: fs.existsSync(startupShortcut()) });
    if (p === '/api/autostart' && req.method === 'POST') {
      const body = await readBody(req);
      const enabled = await setAutostart(!!body.enabled);
      return json(res, 200, { ok: true, enabled });
    }

    if (p === '/api/open/bridge' && req.method === 'GET') {
      const bc = readBridgeConfig();
      const token = encodeURIComponent(String(bc.consoleToken || ''));
      return json(res, 200, { ok: true, url: `http://127.0.0.1:3100/?token=${token}` });
    }

    return json(res, 404, { ok: false, error: '未知接口' });
  } catch (e) {
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`[console] http://127.0.0.1:${cfg.port}`);
  if (cfg.autoStart) {
    setTimeout(() => { void runOp('autostart', startAll); }, 1500);
  }
  // B站自动任务已停用（模拟器里已删除 B站）
});

process.on('uncaughtException', (e) => console.error('[console] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[console] unhandled', e));
