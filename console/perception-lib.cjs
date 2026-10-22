'use strict';
/**
 * perception-lib · 持续抓屏 + 系统回环录音 + zh-CN 语音转文字
 *
 * 数据目录：console/data/perception
 *   latest.jpg      最新画面
 *   status.json     状态
 *   transcript.jsonl 语音转写
 *   stop.flag       停止标记
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = process.env.APP_HOME ? path.resolve(process.env.APP_HOME) : path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'console', 'data', 'perception');
const LATEST = path.join(DIR, 'latest.jpg');
const STATUS = path.join(DIR, 'status.json');
const TRANSCRIPT = path.join(DIR, 'transcript.jsonl');
const STOP = path.join(DIR, 'stop.flag');
const PID = path.join(DIR, 'pid');
const SCRIPT = path.join(ROOT, 'console', 'perception.py');
const PYTHON = process.env.PYTHON || 'python';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  } catch {
    return { running: false };
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function status() {
  const s = readStatus();
  if (s.running && s.pid && !alive(s.pid)) s.running = false;
  return s;
}

function transcript(limit = 20) {
  try {
    const lines = fs.readFileSync(TRANSCRIPT, 'utf8').split(/\r?\n/).filter(Boolean);
    const items = [];
    for (const line of lines.slice(-limit)) {
      try {
        const o = JSON.parse(line);
        if (o && o.text) items.push({ ts: o.ts || '', text: String(o.text) });
      } catch {}
    }
    return items;
  } catch {
    return [];
  }
}

async function start(opts = {}) {
  const cur = status();
  if (cur.running) return { ok: true, already: true, status: cur };
  fs.mkdirSync(DIR, { recursive: true });
  try { fs.unlinkSync(STOP); } catch {}
  try { fs.unlinkSync(PID); } catch {}
  const args = [
    SCRIPT,
    '--mode', String(opts.mode || 'pc'),
    '--seconds', String(opts.seconds == null ? 0 : opts.seconds),
    '--interval', '1.5',
    '--chunk', '5',
  ];
  if (opts.audio === false) args.push('--no-audio');
  const child = spawn(PYTHON, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  child.unref();
  for (let i = 0; i < 16; i++) {
    await sleep(300);
    const s = status();
    if (s.running) return { ok: true, status: s };
  }
  return { ok: false, error: '感知进程没有启动（看 console/data/perception/perception.log）', status: status() };
}

async function stop() {
  const cur = status();
  if (!cur.running) return { ok: true, already: true, status: cur };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(STOP, 'stop', 'utf8');
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const s = status();
    if (!s.running) return { ok: true, status: s };
  }
  const pid = Number(cur.pid || 0);
  if (pid) {
    try { process.kill(pid); } catch {}
    await sleep(500);
  }
  return { ok: true, forced: true, status: status() };
}

function latest() {
  try {
    if (!fs.existsSync(LATEST)) return null;
    return fs.readFileSync(LATEST);
  } catch {
    return null;
  }
}

function read() {
  return { status: status(), transcript: transcript(20), latest: latest() };
}

module.exports = { DIR, LATEST, STATUS, TRANSCRIPT, start, stop, status, transcript, latest, read };