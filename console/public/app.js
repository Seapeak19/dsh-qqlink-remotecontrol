/* 小鲸鱼控制台 · 前端 */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  status: null,
  settings: null,
  view: 'overview',
  logSource: 'bridge',
  editingRole: null,
  roles: [],
  currentRole: null,
  toastTimer: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type === 'error' ? ' error' : '');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.add('hidden'), 3600);
}

function fmtTime(t) {
  if (!t) return '';
  return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── 视图切换 ────────────────────────────────────────────────
const TITLES = {
  overview: ['总览', 'DSH · SnowLuma · OneBot · qq-bridge'],
  settings: ['设置', '路径、QQ、模型、节奏与风控'],
  roles: ['人格', 'roles/*.md · 下一条消息生效'],
  memory: ['记忆', '长期记忆 · 事实/偏好/反馈/承诺/关系/事件'],
  logs: ['日志', 'qq-bridge / SnowLuma / 控制台'],
  apps: ['软件', '电脑软件 · MuMu 模拟器 · 实时感知'],
  files: ['文件', '直接路径 · Word/Excel/PDF · 发送到 QQ'],
  about: ['关于', '小鲸鱼控制台 v1.0.0'],
};

function switchView(view, updateHash = true) {
  state.view = view;
  if (updateHash && location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.add('hidden'));
  const el = $('#view-' + view);
  if (el) el.classList.remove('hidden');
  $('#page-title').textContent = TITLES[view]?.[0] || view;
  $('#page-sub').textContent = TITLES[view]?.[1] || '';
  if (view === 'settings') loadSettings();
  if (view === 'roles') loadRoles();
  if (view === 'memory') loadMemoryPage();
  if (view === 'logs') loadLogs();
  if (view === 'apps') { loadAppsPage(); loadPhone(); loadPhoneApps(); loadPerception(); }
  if (view === 'files') loadFilesPage();
}

$$('.nav').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

// ── 状态渲染 ────────────────────────────────────────────────
function overall() {
  const s = state.status;
  if (!s) return { cls: 'warn', text: '连接中…' };
  if (s.op && s.op.name && !s.op.finishedAt) return { cls: 'warn', text: s.op.step || '处理中…' };
  const dsh = s.dsh.running && s.dsh.baseUrl;
  const sl = s.snowluma.running;
  const qq = s.snowluma.online;
  const ob = s.onebot.http && s.onebot.ws;
  const br = s.bridge.running && s.bridge.dshReady;
  if (dsh && sl && br && ob && qq) return { cls: 'ok', text: '运行中' };
  if (dsh && sl && br && !ob) return { cls: 'warn', text: '等待 QQ 登录' };
  if (dsh && sl && !br) return { cls: 'warn', text: '桥接未运行' };
  if (!dsh) return { cls: 'bad', text: 'DSH 未运行' };
  return { cls: 'warn', text: '未完全就绪' };
}

function cardHtml({ title, ok, stateText, body, actions }) {
  const cls = ok === true ? 'ok' : ok === false ? 'bad' : 'warn';
  return `<div class="card ${cls}">
    <div class="card-head">
      <div class="card-title">${esc(title)}</div>
      <div class="card-state"><span class="dot ${ok === true ? 'on' : ok === false ? 'off' : 'warn'}"></span>${esc(stateText)}</div>
    </div>
    <div class="card-body">${body}</div>
    <div class="card-actions">${actions || ''}</div>
  </div>`;
}

function render() {
  const s = state.status;
  if (!s) return;
  const o = overall();
  const pill = $('#status-pill');
  pill.textContent = o.text;
  pill.className = 'pill ' + o.cls;

  $('#conn-dot').className = 'dot on';
  $('#conn-text').textContent = '控制台已连接';

  const opRunning = !!(s.op && s.op.name && !s.op.finishedAt);
  $('#btn-start').disabled = opRunning;
  $('#btn-stop').disabled = opRunning;
  $('#btn-restart').disabled = opRunning;

  // 操作横幅
  const banner = $('#op-banner');
  if (opRunning) {
    banner.className = 'banner';
    banner.textContent = `⏳ ${s.op.name}：${s.op.step || '处理中…'}（${fmtTime(s.op.startedAt)} 开始）`;
  } else if (s.op && s.op.error) {
    banner.className = 'banner error';
    banner.textContent = `❌ 上一次操作失败：${s.op.error}`;
  } else {
    banner.className = 'banner hidden';
  }

  // 四张卡
  const dsh = s.dsh;
  const sl = s.snowluma;
  const ob = s.onebot;
  const br = s.bridge;
  const qqOnline = sl.online;
  const cards = [];

  cards.push(cardHtml({
    title: 'DSH · 大脑',
    ok: dsh.running && !!dsh.baseUrl,
    stateText: dsh.running ? (dsh.baseUrl ? '运行中' : '运行中 · API 未发现') : '未运行',
    body: `
      <div>进程 <b>${dsh.pid || '—'}</b></div>
      <div>API <b>${esc(dsh.baseUrl || '未发现')}</b></div>
      <div class="muted">DSH 端口每次启动会变，控制台会自动发现。</div>`,
    actions: `
      ${dsh.baseUrl ? `<button class="btn tiny ghost" data-act="open-dsh">打开 DSH</button>` : ''}
      ${!dsh.running ? `<button class="btn tiny primary" data-act="start-all">启动</button>` : ''}`,
  }));

  cards.push(cardHtml({
    title: 'SnowLuma · QQ 网关',
    ok: sl.running ? (qqOnline === true ? true : null) : false,
    stateText: !sl.running ? '未运行' : qqOnline === true ? '在线' : qqOnline === false ? '网关在跑 · QQ 离线' : '网关在跑',
    body: `
      <div>UIN <b>${esc(sl.uin || '—')}</b></div>
      <div>QQ <b class="${qqOnline === true ? 'ok' : qqOnline === false ? 'bad' : 'warn'}">${qqOnline === null ? '未知' : qqOnline ? '在线' : '离线'}</b>
        ${sl.good === true ? '· 接收链路 good' : sl.good === false ? '· <span class="bad">接收链路异常</span>' : ''}</div>
      <div>WebUI <b>http://127.0.0.1:${sl.webuiPort || 5099}</b></div>`,
    actions: `
      <button class="btn tiny ghost" data-act="open-webui">打开 WebUI</button>
      ${!sl.running ? `<button class="btn tiny primary" data-act="start-snow">启动</button>` : `<button class="btn tiny ghost" data-act="stop-snow">停止</button>`}`,
  }));

  cards.push(cardHtml({
    title: 'OneBot · 消息通道',
    ok: ob.http && ob.ws,
    stateText: ob.http && ob.ws ? '已就绪' : '等待 QQ 登录',
    body: `
      <div>HTTP 3000 <b class="${ob.http ? 'ok' : 'warn'}">${ob.http ? '监听中' : '未监听'}</b></div>
      <div>WS 3001 <b class="${ob.ws ? 'ok' : 'warn'}">${ob.ws ? '监听中' : '未监听'}</b></div>
      <div class="muted">这两个端口要等 QQ 小号登录后才出现。</div>`,
    actions: '',
  }));

  cards.push(cardHtml({
    title: 'qq-bridge · 接线员',
    ok: br.running ? (br.dshReady ? true : null) : false,
    stateText: br.running ? (br.dshReady ? '运行中' : '运行中 · DSH 未就绪') : '未运行',
    body: `
      <div>模式 <b>${esc(br.mode || '—')}</b> · 人格 <b>${esc(br.role || '未设置')}</b></div>
      <div>DSH <b class="${br.dshReady ? 'ok' : 'warn'}">${br.dshReady ? '已就绪' : '未就绪'}</b>
        · SnowLuma <b class="${br.snowluma?.connected ? 'ok' : 'warn'}">${br.snowluma?.connected ? '已连接' : '未连接'}</b></div>
      <div class="muted">控制台端口 <b>3100</b> · 进程 <b>${br.pid || '—'}</b></div>`,
    actions: `
      ${br.running ? `<button class="btn tiny ghost" data-act="open-bridge">桥接控制台</button>
        <button class="btn tiny ghost" data-act="restart-bridge">重启</button>
        <button class="btn tiny danger" data-act="stop-bridge">停止</button>` : `<button class="btn tiny primary" data-act="start-bridge">启动</button>`}`,
  }));

  $('#cards').innerHTML = cards.join('');

  // 总览保持简洁：不显示模拟器，也不显示桥接活动流水

  // 旧 companion 警告
  const legacy = s.legacy || [];
  const box = $('#legacy-box');
  if (legacy.length) {
    box.className = 'banner warn';
    box.innerHTML = `⚠️ 检测到旧的 companion 进程仍在运行（PID ${legacy.map((p) => p.pid).join(', ')}）。
      它和 qq-bridge 会同时回复消息，建议停掉。
      <button class="btn tiny danger" data-act="stop-legacy" style="margin-left:10px">停掉旧 companion</button>`;
  } else {
    box.className = 'banner warn hidden';
  }
}

async function refreshStatus() {
  try {
    const j = await api('/api/status');
    state.status = j.status;
    render();
  } catch (e) {
    $('#conn-dot').className = 'dot off';
    $('#conn-text').textContent = '控制台未连接';
    $('#status-pill').textContent = '连接失败';
    $('#status-pill').className = 'pill bad';
  }
}

// ── 全局操作 ────────────────────────────────────────────────
async function post(path, body) {
  const j = await api(path, { method: 'POST', body: JSON.stringify(body || {}) });
  return j;
}

$('#btn-start').addEventListener('click', async () => {
  try { await post('/api/start'); toast('已开始启动全部组件…'); refreshStatus(); } catch (e) { toast(e.message, 'error'); }
});
$('#btn-stop').addEventListener('click', async () => {
  if (!confirm('停止 qq-bridge 和 SnowLuma？（DSH 不会关）')) return;
  try { await post('/api/stop'); toast('已开始停止…'); refreshStatus(); } catch (e) { toast(e.message, 'error'); }
});
$('#btn-restart').addEventListener('click', async () => {
  try { await post('/api/restart'); toast('正在重启 qq-bridge…'); refreshStatus(); } catch (e) { toast(e.message, 'error'); }
});

// ── 卡片按钮 ────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  try {
    if (act === 'open-dsh') {
      const url = state.status?.dsh?.baseUrl;
      if (url) window.open(url, '_blank');
    } else if (act === 'open-webui') {
      window.open(`http://127.0.0.1:${state.status?.snowluma?.webuiPort || 5099}`, '_blank');
    } else if (act === 'open-bridge') {
      const j = await api('/api/open/bridge');
      window.open(j.url, '_blank');
    } else if (act === 'start-all') {
      await post('/api/start'); toast('正在启动…'); refreshStatus();
    } else if (act === 'start-snow') {
      await post('/api/start/snowluma'); toast('正在启动 SnowLuma…'); refreshStatus();
    } else if (act === 'stop-snow') {
      await post('/api/stop/snowluma'); toast('正在停止 SnowLuma…'); refreshStatus();
    } else if (act === 'start-bridge') {
      await post('/api/start/bridge'); toast('正在启动 qq-bridge…'); refreshStatus();
    } else if (act === 'stop-bridge') {
      await post('/api/stop/bridge'); toast('正在停止 qq-bridge…'); refreshStatus();
    } else if (act === 'restart-bridge') {
      await post('/api/restart'); toast('正在重启 qq-bridge…'); refreshStatus();
    } else if (act === 'stop-legacy') {
      await post('/api/stop/legacy'); toast('已停止旧 companion'); refreshStatus();
    } else if (act === 'phone-start') {
      await post('/api/phone/start'); toast('正在启动模拟器…'); setTimeout(loadPhone, 4000);
    } else if (act === 'phone-connect') {
      const j = await post('/api/phone/connect'); toast(j.output || (j.ok ? '已连接' : '连接失败')); loadPhone();
    } else if (act === 'phone-keyboard') {
      const j = await post('/api/phone/keyboard'); toast(j.output || '已安装'); loadPhone();
    } else if (act === 'mem-distill') {
      toast('正在提炼最近聊天…');
      const j = await post('/api/memory/distill');
      toast(`新增 ${(j.added || []).length} 条`);
      loadMemoryPage();
    } else if (act === 'mem-auto-toggle') {
      const on = btn.dataset.on !== '1';
      await post('/api/memory/auto', { enabled: on });
      toast(on ? '自动记忆已开启' : '自动记忆已暂停');
      loadMemoryPage();
    } else if (act === 'mem-del') {
      await post('/api/memory/remove', { id: btn.dataset.id });
      toast('已删除');
      loadMemoryPage();
    } else if (act === 'app-launch') {
      const j = await post('/api/apps/launch', { id: btn.dataset.id });
      toast(j.ok ? '已启动' : (j.error || '启动失败'));
      setTimeout(loadAppsPage, 2500);
    } else if (act === 'app-shot') {
      const j = await post('/api/apps/snapshot', { id: btn.dataset.id });
      const img = $('#app-shot');
      img.src = j.url;
      img.classList.add('on');
      $('#app-shot-hint').textContent = '已更新 ' + new Date().toLocaleTimeString();
    } else if (act === 'app-toggle') {
      await post('/api/apps/toggle', { id: btn.dataset.id, enabled: btn.dataset.enabled === '1' });
      loadAppsPage();
    } else if (act === 'app-del') {
      await post('/api/apps/remove', { id: btn.dataset.id });
      toast('已删除');
      loadAppsPage();
    } else if (act === 'file-root-del') {
      await post('/api/files/root/remove', { path: btn.dataset.path });
      toast('已移除');
      fileState.path = '';
      loadFilesPage();
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── 设置 ────────────────────────────────────────────────────
function fillSettings(s) {
  const g = s.gui, b = s.bridge;
  $('#set-dsh-exe').value = g.dshExe || '';
  $('#set-dsh-url').value = g.dshBaseUrl || '';
  $('#set-snow-dir').value = g.snowDir || '';
  $('#set-bridge-dir').value = g.bridgeDir || '';
  $('#set-auto-start').checked = !!g.autoStart;
  $('#set-auto-dsh').checked = !!g.autoStartDsh;

  $('#set-owner').value = b.ownerQQ || '';
  $('#set-allow-private').value = b.allowPrivate || '';
  $('#set-allow-groups').value = b.allowGroups || '';
  $('#set-allow-all').checked = !!b.allowAllWhenEmpty;

  $('#set-model').value = b.model || '';
  $('#set-effort').value = b.reasoningEffort || 'max';
  $('#set-preset').value = b.agentPreset || '';
  $('#set-preset-v2').value = b.socialV2AgentPreset || '';
  $('#set-mode').value = b.mode || 'reserved2';
  $('#set-role-limit').value = b.roleMaxInjectChars || 8000;

  $('#set-send-delay').value = b.sendDelayMs ?? 800;
  $('#set-max-min').value = b.maxSendPerMinute ?? 6;
  $('#set-max-hour').value = b.maxSendPerHour ?? 80;
  $('#set-max-chars').value = b.maxMessageChars ?? 500;
  $('#set-reply-chars').value = b.maxReplyChars ?? 500;
  $('#set-proactive').checked = !!b.proactive;

  $('#set-port').value = g.port || 3900;
  $('#set-console-token').value = b.consoleToken || '';
  $('#set-autostart').checked = !!s.autostart;

  const mu = s.mumu || {};
  $('#set-mumu-manager').value = mu.manager || '';
  $('#set-mumu-adb').value = mu.adb || '';
  $('#set-mumu-instance').value = mu.instance ?? 0;
  $('#set-mumu-serial').value = mu.serial || '';
  $('#set-mumu-auto').checked = mu.autoStart !== false;
}

async function loadSettings() {
  try {
    const j = await api('/api/settings');
    state.settings = j.settings;
    fillSettings(j.settings);
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#btn-rotate-token').addEventListener('click', () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  $('#set-console-token').value = token;
  toast('已生成新令牌，保存后生效（桥接会重启）');
});

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    gui: {
      autoStart: $('#set-auto-start').checked,
      autoStartDsh: $('#set-auto-dsh').checked,
      dshExe: $('#set-dsh-exe').value.trim(),
      dshBaseUrl: $('#set-dsh-url').value.trim(),
      snowDir: $('#set-snow-dir').value.trim(),
      bridgeDir: $('#set-bridge-dir').value.trim(),
    },
    bridge: {
      ownerQQ: $('#set-owner').value.trim(),
      allowPrivate: $('#set-allow-private').value.trim(),
      allowGroups: $('#set-allow-groups').value.trim(),
      allowAllWhenEmpty: $('#set-allow-all').checked,
      model: $('#set-model').value.trim(),
      reasoningEffort: $('#set-effort').value,
      agentPreset: $('#set-preset').value.trim(),
      socialV2AgentPreset: $('#set-preset-v2').value.trim(),
      mode: $('#set-mode').value,
      roleMaxInjectChars: Number($('#set-role-limit').value) || 8000,
      sendDelayMs: Number($('#set-send-delay').value) || 0,
      maxSendPerMinute: Number($('#set-max-min').value) || 6,
      maxSendPerHour: Number($('#set-max-hour').value) || 80,
      maxMessageChars: Number($('#set-max-chars').value) || 500,
      maxReplyChars: Number($('#set-reply-chars').value) || 500,
      proactive: $('#set-proactive').checked,
      consoleToken: $('#set-console-token').value.trim(),
    },
    mumu: {
      manager: $('#set-mumu-manager').value.trim(),
      adb: $('#set-mumu-adb').value.trim(),
      instance: Number($('#set-mumu-instance').value) || 0,
      serial: $('#set-mumu-serial').value.trim(),
      autoStart: $('#set-mumu-auto').checked,
    },
  };
  try {
    const r = await post('/api/settings', body);
    await post('/api/autostart', { enabled: $('#set-autostart').checked });
    $('#save-hint').textContent = r.restartRequired ? '已保存。涉及桥接的项需要点「重启桥接」才会生效。' : '已保存。';
    toast('设置已保存');
    await loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ── 人格 ────────────────────────────────────────────────────
async function loadRoles() {
  try {
    const j = await api('/api/roles');
    state.roles = j.roles || [];
    state.currentRole = j.current || null;
    const summaries = j.summaries || state.roles.map((name) => ({ name }));
    const list = $('#role-list');
    if (!summaries.length) {
      list.innerHTML = '<div class="muted" style="padding:8px">还没有人格文件。</div>';
    } else {
      list.innerHTML = summaries.map((r) => `
        <button class="role-item ${r.name === state.editingRole ? 'active' : ''}" data-role="${esc(r.name)}">
          <span>${esc(r.name)} ${r.name === state.currentRole ? '· 当前' : ''}</span>
          <small>${r.chars ? r.chars + ' 字' : ''}</small>
        </button>`).join('');
    }
    if (!state.editingRole) {
      const pick = state.currentRole || state.roles[0];
      if (pick) await selectRole(pick);
    } else {
      updateRoleBadge();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

function updateRoleBadge() {
  const badge = $('#role-current-badge');
  badge.classList.toggle('hidden', state.editingRole !== state.currentRole);
}

async function selectRole(name) {
  try {
    const j = await api('/api/roles/content?name=' + encodeURIComponent(name));
    state.editingRole = name;
    $('#role-editor-title').textContent = '编辑：' + name;
    $('#role-name').value = name;
    $('#role-content').value = j.content || '';
    $('#role-hint').textContent = j.chars ? `${j.chars} 字符` : '';
    updateRoleBadge();
    $$('.role-item').forEach((b) => b.classList.toggle('active', b.dataset.role === name));
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#role-list').addEventListener('click', (e) => {
  const item = e.target.closest('[data-role]');
  if (item) selectRole(item.dataset.role);
});

$('#btn-new-role').addEventListener('click', () => {
  const name = prompt('新人物的名字（中文/英文都行）：');
  if (!name) return;
  state.editingRole = null;
  $('#role-editor-title').textContent = '新建人格';
  $('#role-name').value = name.trim();
  $('#role-content').value = '';
  $('#role-hint').textContent = '写好后点保存';
  $('#role-current-badge').classList.add('hidden');
  $$('.role-item').forEach((b) => b.classList.remove('active'));
});

$('#btn-save-role').addEventListener('click', async () => {
  const name = $('#role-name').value.trim();
  const content = $('#role-content').value;
  if (!name) return toast('先填名字', 'error');
  if (!content.trim()) return toast('人格内容是空的', 'error');
  try {
    const j = await post('/api/roles/save', { name, content, activate: false });
    toast('已保存：' + (j.role || name));
    state.editingRole = j.role || name;
    await loadRoles();
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#btn-activate-role').addEventListener('click', async () => {
  const name = $('#role-name').value.trim() || state.editingRole;
  if (!name) return toast('先选一个人格', 'error');
  try {
    await post('/api/roles/activate', { name });
    state.currentRole = name;
    toast('已设为当前人格（下一条消息生效）');
    await loadRoles();
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#btn-delete-role').addEventListener('click', async () => {
  const name = state.editingRole || $('#role-name').value.trim();
  if (!name) return toast('先选一个人格', 'error');
  if (!confirm(`删除人格「${name}」？`)) return;
  try {
    await post('/api/roles/delete', { name });
    toast('已删除');
    state.editingRole = null;
    await loadRoles();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ── 日志 ────────────────────────────────────────────────────
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  state.logSource = t.dataset.source;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  loadLogs();
}));

async function loadLogs() {
  try {
    const j = await api('/api/logs?source=' + encodeURIComponent(state.logSource) + '&lines=300');
    const text = j.text || '';
    $('#log-text').textContent = text || '（日志为空。\n用控制台启动 qq-bridge 后，这里会有输出；SnowLuma 的日志在 SnowLuma/logs。）';
    $('#log-file').textContent = j.file || '';
    const pre = $('#log-text');
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    $('#log-text').textContent = '读取日志失败：' + e.message;
  }
}

// ── 模拟器 ──────────────────────────────────────────────────
async function loadPhone() {
  try {
    const j = await api('/api/phone/status');
    renderPhone(j.phone);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderPhone(p) {
  const info = p.info || {};
  const cards = [
    cardHtml({
      title: 'MuMu 实例',
      ok: info.is_android_started ? true : info.is_process_started ? null : false,
      stateText: info.is_android_started ? 'Android 已启动' : info.is_process_started ? '进程在 · 系统未就绪' : '未启动',
      body: `
        <div>名称 <b>${esc(info.name || '—')}</b> · 实例 <b>${esc(p.instance)}</b></div>
        <div>Android <b>${esc(p.androidVersion || info.android_version || '—')}</b></div>
        <div>adb 端口 <b>${esc(info.adb_port || '—')}</b></div>`,
      actions: `<button class="btn tiny primary" data-act="phone-start">启动</button>`,
    }),
    cardHtml({
      title: 'adb 连接',
      ok: p.connected,
      stateText: p.connected ? '已连接' : '未连接',
      body: `
        <div>serial <b>${esc(p.serial)}</b></div>
        <div>屏幕 <b>${esc(p.screen || '—')}</b></div>
        <div class="muted">${esc(String(p.devices || '').split('\n').slice(0, 3).join(' · '))}</div>`,
      actions: `<button class="btn tiny" data-act="phone-connect">连接 adb</button>`,
    }),
    cardHtml({
      title: '中文输入',
      ok: p.keyboard,
      stateText: p.keyboard ? 'ADBKeyboard 已安装' : '未安装',
      body: `
        <div>中文输入依赖 ADBKeyboard 输入法。</div>
        <div class="muted">装一次即可；phone_text 会自动切换。</div>`,
      actions: `<button class="btn tiny ghost" data-act="phone-keyboard">安装</button>`,
    }),
  ];
  $('#phone-cards').innerHTML = cards.join('');
  $('#phone-shot-hint').textContent = p.connected ? '已连接，点「截图」' : '未连接 adb';
  const img = $('#phone-shot');
  if (p.hasShot && !img.classList.contains('on')) {
    img.src = '/api/phone/shot';
    img.classList.add('on');
  } else if (!p.hasShot) {
    img.classList.remove('on');
    img.removeAttribute('src');
  }
}

async function phoneScreenshot() {
  try {
    const j = await post('/api/phone/screenshot');
    const img = $('#phone-shot');
    img.src = j.url;
    img.classList.add('on');
    $('#phone-shot-hint').textContent = '已更新 ' + new Date().toLocaleTimeString();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadPhoneApps() {
  try {
    const j = await api('/api/phone/apps');
    const sel = $('#phone-apps');
    const apps = j.apps || [];
    sel.innerHTML = apps.length
      ? apps.map((pkg) => `<option value="${esc(pkg)}">${esc(pkg)}</option>`).join('')
      : '<option value="">（没有第三方应用）</option>';
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#btn-phone-start').addEventListener('click', async () => {
  try { await post('/api/phone/start'); toast('正在启动模拟器…'); setTimeout(loadPhone, 4000); } catch (e) { toast(e.message, 'error'); }
});
$('#btn-phone-connect').addEventListener('click', async () => {
  try { const j = await post('/api/phone/connect'); toast(j.output || (j.ok ? '已连接' : '连接失败')); loadPhone(); } catch (e) { toast(e.message, 'error'); }
});
$('#btn-phone-shot').addEventListener('click', phoneScreenshot);
$('#btn-phone-keyboard').addEventListener('click', async () => {
  try { const j = await post('/api/phone/keyboard'); toast(j.output || '已安装'); loadPhone(); } catch (e) { toast(e.message, 'error'); }
});
$('#btn-phone-refresh').addEventListener('click', loadPhoneApps);
$('#btn-phone-open').addEventListener('click', async () => {
  const pkg = $('#phone-apps').value;
  if (!pkg) return toast('先选一个 App', 'error');
  try { await post('/api/phone/open', { pkg }); toast('已打开 ' + pkg); setTimeout(phoneScreenshot, 1500); } catch (e) { toast(e.message, 'error'); }
});

// ── 记忆 ────────────────────────────────────────────────────
const MEM_LABEL = { facts: '事实', preferences: '偏好', promises: '承诺/提醒', relations: '关系', feedback: '反馈', events: '事件' };
const SRC_LABEL = { auto: '自动', distill: '手动提炼', console: '手动添加', import: '导入' };

async function loadMemoryPage() {
  try {
    const j = await api('/api/memory');
    renderMemoryPage(j);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderMemoryPage(j) {
  const m = j?.memory || {};
  const c = j?.counts || {};
  const a = j?.auto || {};
  const lastRun = a.lastRunAt
    ? new Date(a.lastRunAt).toLocaleString('zh-CN', { hour12: false })
    : '还没跑过';
  const on = !!a.enabled;
  const cards = [
    cardHtml({
      title: '自动记忆',
      ok: on ? (a.lastError ? null : true) : false,
      stateText: on ? (a.busy ? '提炼中…' : a.lastError ? '上次失败' : '运行中') : '已暂停',
      body: `
        <div>上次提炼 <b>${esc(lastRun)}</b> · 累计自动记下 <b>${a.totalAdded || 0}</b> 条</div>
        <div class="muted">有新聊天（≥${a.minNewMessages || 6} 条）且安静 ${a.quietSec || 90} 秒后自动提炼，最多每 ${a.everyMin || 15} 分钟一次</div>
        ${a.lastError ? `<div class="bad">${esc(a.lastError)}</div>` : ''}`,
      actions: `
        <button class="btn tiny ${on ? 'ghost' : 'primary'}" data-act="mem-auto-toggle" data-on="${on ? 1 : 0}">${on ? '暂停' : '开启'}</button>
        <button class="btn tiny ghost" data-act="mem-distill">立即提炼</button>`,
    }),
    cardHtml({
      title: '长期记忆',
      ok: (c.total || 0) > 0,
      stateText: `${c.total || 0} 条`,
      body: `<div>事实 <b>${c.facts || 0}</b> · 偏好 <b>${c.preferences || 0}</b> · 反馈 <b>${c.feedback || 0}</b></div>
        <div>承诺 <b>${c.promises || 0}</b> · 关系 <b>${c.relations || 0}</b> · 事件 <b>${c.events || 0}</b></div>`,
      actions: '',
    }),
    cardHtml({
      title: '同步状态',
      ok: true,
      stateText: '已同步到人格',
      body: `<div class="muted">${esc(j?.file || '')}</div>
        <div class="muted">每次写入都会更新人格末尾的自动区块，QQ 每轮可见</div>`,
      actions: '',
    }),
  ];
  $('#memory-cards').innerHTML = cards.join('');
  $('#mem-hint').textContent = m.updatedAt
    ? `更新于 ${new Date(m.updatedAt).toLocaleString('zh-CN', { hour12: false })}`
    : '';
  const parts = [];
  for (const cat of ['facts', 'preferences', 'feedback', 'promises', 'relations', 'events']) {
    const list = m[cat] || [];
    if (!list.length) continue;
    parts.push(`<div class="memory-group"><h3>${MEM_LABEL[cat]}（${list.length}）</h3>${list.map((e) => `
      <div class="memory-item">
        <div class="txt">${esc(e.text)}${e.target ? ` <span class="muted">（${esc(e.target)}）</span>` : ''}${e.dueAt ? ` <span class="muted">· ${esc(e.dueAt)}</span>` : ''}${e.done ? ' <span class="muted">· 已完成</span>' : ''}
          <div class="meta">${esc(SRC_LABEL[e.source] || e.source || '')}${e.at ? ' · ' + new Date(e.at).toLocaleString('zh-CN', { hour12: false }) : ''}</div>
        </div>
        <button class="btn tiny ghost" data-act="mem-del" data-id="${esc(e.id)}">删</button>
      </div>`).join('')}</div>`);
  }
  $('#memory-list').innerHTML = parts.length
    ? parts.join('')
    : '<p class="muted">还没有长期记忆。等自动记忆跑一次，或手动加一条。</p>';
}

$('#btn-mem-add').addEventListener('click', async () => {
  const text = $('#mem-text').value.trim();
  if (!text) return toast('先写内容', 'error');
  try {
    const j = await post('/api/memory/add', {
      category: $('#mem-category').value,
      text,
      target: $('#mem-target').value.trim(),
      dueAt: $('#mem-due').value.trim(),
    });
    toast(j.duplicate ? '已经记过了' : '已记下');
    $('#mem-text').value = '';
    $('#mem-target').value = '';
    $('#mem-due').value = '';
    loadMemoryPage();
  } catch (e) { toast(e.message, 'error'); }
});
$('#btn-mem-refresh').addEventListener('click', loadMemoryPage);
$('#btn-mem-import').addEventListener('click', async () => {
  const raw = $('#mem-import').value.trim();
  if (!raw) return toast('先粘贴 JSON', 'error');
  try {
    await post('/api/memory/import', { json: raw });
    toast('已合并导入');
    $('#mem-import').value = '';
    loadMemoryPage();
  } catch (e) { toast(e.message, 'error'); }
});

// ── 授权应用 ────────────────────────────────────────────────
let runningApps = [];
let installedApps = [];

async function loadAppsPage() {
  try {
    const j = await api('/api/apps');
    renderAppsPage(j);
    try {
      const r = await api('/api/apps/running');
      runningApps = r.items || [];
    } catch { runningApps = []; }
    renderRunningOptions();
    if (!installedApps.length) void scanInstalledApps();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderRunningOptions() {
  const sel = $('#app-running');
  if (!sel) return;
  sel.innerHTML = '<option value="">（从运行中的窗口选择）</option>' + runningApps.map((x, i) =>
    `<option value="${i}">${esc(x.process)} | ${esc(x.title || '')}</option>`).join('');
}

function renderAppsPage(j) {
  const apps = j.apps || [];
  const running = j.running || [];
  const runningCount = apps.filter((a) => running.some((r) => r.process && r.process.toLowerCase() === a.process.toLowerCase())).length;
  $('#app-cards').innerHTML = [
    cardHtml({
      title: '授权软件',
      ok: true,
      stateText: `${apps.length} 个`,
      body: `<div>运行中 ${runningCount} 个</div><div class="muted">只有名单内的窗口能被操作</div>`,
      actions: '',
    }),
    cardHtml({
      title: '安全边界',
      ok: apps.length > 0,
      stateText: apps.length ? '已配置' : '未配置',
      body: '<div>启动 / 截图 / 点击 / 输入 / 按键 / 滚轮</div><div class="muted">坐标被限制在授权窗口内</div>',
      actions: '',
    }),
  ].join('');
  $('#app-hint').textContent = j.runningError ? '运行状态获取失败：' + j.runningError : '';
  $('#app-list').innerHTML = apps.length ? apps.map((a) => {
    const run = a.screen ? null : running.find((r) => r.process && r.process.toLowerCase() === a.process.toLowerCase());
    const desc = a.screen
      ? '整屏截图（含桌面和所有窗口）'
      : `进程 ${esc(a.process)} · ${run ? '运行中：' + esc(run.title || '') : '未启动'}`;
    return `<div class="app-row ${a.enabled ? '' : 'off'}">
      <div class="main">
        <div class="name">${esc(a.name)} <span class="muted">#${esc(a.id)}</span></div>
        <div class="meta">${desc} · 动作 ${esc((a.allow || []).join(','))}</div>
        <div class="meta">${a.screen ? '只读画面' : esc(a.exe || '')}</div>
      </div>
      <div class="actions">
        ${a.screen ? '' : `<button class="btn tiny" data-act="app-launch" data-id="${esc(a.id)}">启动</button>`}
        <button class="btn tiny" data-act="app-shot" data-id="${esc(a.id)}">截图</button>
        <button class="btn tiny ghost" data-act="app-toggle" data-id="${esc(a.id)}" data-enabled="${a.enabled ? '0' : '1'}">${a.enabled ? '停用' : '启用'}</button>
        <button class="btn tiny danger" data-act="app-del" data-id="${esc(a.id)}">删除</button>
      </div>
    </div>`;
  }).join('') : '<p class="muted">还没有授权软件。从上面的运行窗口选一个，或手动填进程名。</p>';
}

$('#app-running').addEventListener('change', () => {
  const x = runningApps[Number($('#app-running').value)];
  if (!x) return;
  $('#app-process').value = x.process || '';
  $('#app-exe').value = x.exe || '';
  $('#app-title').value = '';
  $('#app-name').value = x.process || '';
});
$('#btn-app-add').addEventListener('click', async () => {
  const allow = [...document.querySelectorAll('#app-actions input:checked')].map((x) => x.value);
  try {
    const j = await post('/api/apps/add', {
      name: $('#app-name').value.trim(),
      process: $('#app-process').value.trim(),
      exe: $('#app-exe').value.trim(),
      titlePattern: $('#app-title').value.trim(),
      allow,
    });
    toast('已授权 ' + j.app.name);
    loadAppsPage();
  } catch (e) { toast(e.message, 'error'); }
});
async function scanInstalledApps() {
  try {
    const j = await api('/api/apps/installed');
    installedApps = j.items || [];
    const sel = $('#app-installed');
    sel.innerHTML = '<option value="">（从已安装软件选择）</option>' + installedApps.map((x, i) =>
      `<option value="${i}">${esc(x.name)} | ${esc(x.process)}</option>`).join('');
    toast(`找到 ${installedApps.length} 个已安装软件`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#app-installed').addEventListener('change', () => {
  const x = installedApps[Number($('#app-installed').value)];
  if (!x) return;
  $('#app-name').value = x.name || x.process || '';
  $('#app-process').value = x.process || '';
  $('#app-exe').value = x.exe || '';
});

$('#btn-app-scan').addEventListener('click', scanInstalledApps);

$('#btn-app-pick').addEventListener('click', async () => {
  toast('请在桌面弹出的窗口里选择 exe…');
  try {
    const j = await post('/api/apps/pick-exe');
    if (!j.ok) {
      toast(j.canceled ? '已取消' : (j.error || '没有选择'));
      return;
    }
    $('#app-exe').value = j.exe || '';
    $('#app-process').value = j.process || '';
    $('#app-name').value = j.name || j.process || '';
    toast('已识别：' + (j.name || j.process));
  } catch (e) {
    toast(e.message, 'error');
  }
});

$('#app-exe').addEventListener('change', async () => {
  const exe = $('#app-exe').value.trim();
  if (!exe) return;
  try {
    const j = await post('/api/apps/inspect', { exe });
    if (j.ok) {
      if (!$('#app-process').value.trim()) $('#app-process').value = j.process || '';
      if (!$('#app-name').value.trim()) $('#app-name').value = j.name || j.process || '';
    }
  } catch {}
});

$('#btn-app-refresh').addEventListener('click', loadAppsPage);

// ── 实时感知 ────────────────────────────────────────────────
function renderPerception(j) {
  const s = j.status || {};
  const lines = [];
  if (s.running) {
    lines.push(`运行中 · ${s.mode === 'emulator' ? '模拟器' : '电脑'} · 已抓 ${s.frames || 0} 帧 · 已转 ${s.transcripts || 0} 段`);
  } else {
    lines.push('未运行。点「开始看」启动持续抓屏 + 语音转文字。');
  }
  if (s.lastText) lines.push('最近一句：' + s.lastText);
  if (s.lastError) lines.push('错误：' + s.lastError);
  const tr = j.transcript || [];
  if (tr.length) {
    lines.push('');
    for (const x of tr) lines.push(`[${x.ts}] ${x.text}`);
  }
  $('#perception-text').textContent = lines.join('\n');
  if (j.hasImage || s.frames) {
    $('#perception-img').src = '/api/perception/latest.jpg?t=' + Date.now();
  }
}

async function loadPerception() {
  try { renderPerception(await api('/api/perception')); } catch {}
}

$('#btn-perception-start').addEventListener('click', async () => {
  const mode = $('#perception-mode').value || 'pc';
  try {
    const j = await post('/api/perception/start', { mode, seconds: 0 });
    if (!j.ok) return toast(j.error || '启动失败', 'error');
    toast('已开始持续感知');
    loadPerception();
  } catch (e) { toast(e.message, 'error'); }
});
$('#btn-perception-stop').addEventListener('click', async () => {
  try { await post('/api/perception/stop'); toast('已停止'); loadPerception(); }
  catch (e) { toast(e.message, 'error'); }
});
$('#btn-perception-refresh').addEventListener('click', loadPerception);

// ── 文件 ────────────────────────────────────────────────────
const fileState = { roots: [], path: '', entries: [], parent: null, selected: '', unrestricted: true, home: '' };

async function loadFilesPage() {
  try {
    const j = await api('/api/files');
    fileState.roots = j.roots || [];
    fileState.unrestricted = j.unrestricted !== false;
    fileState.home = j.home || '';
    const mode = $('#file-mode');
    if (mode) mode.textContent = fileState.unrestricted
      ? '无限制模式：可直接按路径访问（系统目录禁写；.ssh/凭据/浏览器数据禁读）'
      : '受限模式：只能访问常用文件夹';
    renderFileRoots();
    const start = fileState.roots[0]?.path || fileState.home;
    if (!fileState.path && start) await openFilePath(start);
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderFileRoots() {
  $('#file-roots').innerHTML = fileState.roots.length
    ? fileState.roots.map((r) => `<div class="file-root"><div class="path">${esc(r.path)}</div><button class="btn tiny danger" data-act="file-root-del" data-path="${esc(r.path)}">移除</button></div>`).join('')
    : '<p class="muted">还没有授权文件夹。</p>';
}

async function openFilePath(p) {
  try {
    const j = await api('/api/files/list?path=' + encodeURIComponent(p));
    fileState.path = j.path;
    fileState.parent = j.parent || null;
    fileState.entries = j.entries || [];
    fileState.selected = '';
    $('#file-path').textContent = j.path;
    $('#file-preview').textContent = '';
    $('#file-send-hint').textContent = '选中文件后可发送到 QQ';
    $('#file-list').innerHTML = fileState.entries.length ? fileState.entries.map((e) => `
      <button class="file-row" data-fpath="${esc(e.path)}" data-fdir="${e.dir ? '1' : '0'}">
        <span class="name">${e.dir ? '📁' : '📄'} ${esc(e.name)}</span>
        <span class="meta">${e.dir ? '' : (e.size + ' bytes')}</span>
      </button>`).join('') : '<p class="muted">（空目录）</p>';
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function previewFilePath(p) {
  try {
    const j = await api('/api/files/read?path=' + encodeURIComponent(p));
    fileState.selected = p;
    let text = '';
    if (j.kind === 'docx') text = `Word · 段落 ${j.paragraphCount}\n\n${j.text || ''}`;
    else if (j.kind === 'xlsx') text = `Excel · ${j.sheet} ${j.dimensions}\n\n` + (j.rows || []).map((r) => r.join('\t')).join('\n');
    else text = j.text || j.message || '';
    $('#file-preview').textContent = text;
    $('#file-send-hint').textContent = '已选中：' + p;
  } catch (e) {
    toast(e.message, 'error');
  }
}

$('#file-list').addEventListener('click', (e) => {
  const row = e.target.closest('.file-row');
  if (!row) return;
  if (row.dataset.fdir === '1') openFilePath(row.dataset.fpath);
  else previewFilePath(row.dataset.fpath);
});

$('#btn-file-open-path').addEventListener('click', () => {
  const p = $('#file-open-path').value.trim();
  if (!p) return toast('先输入路径', 'error');
  openFilePath(p);
});
$('#btn-file-up').addEventListener('click', () => {
  if (fileState.parent) openFilePath(fileState.parent);
  else toast('已经是授权根目录');
});
$('#btn-file-refresh').addEventListener('click', () => {
  if (fileState.path) openFilePath(fileState.path);
  else loadFilesPage();
});
$('#btn-file-add-root').addEventListener('click', async () => {
  const p = $('#file-root-input').value.trim();
  if (!p) return toast('先填文件夹路径', 'error');
  try {
    const j = await post('/api/files/root/add', { path: p });
    toast('已授权');
    fileState.path = '';
    fileState.roots = j.roots || [];
    renderFileRoots();
    if (fileState.roots.length) await openFilePath(fileState.roots[0].path);
  } catch (e) { toast(e.message, 'error'); }
});
$('#btn-file-pick-folder').addEventListener('click', async () => {
  toast('请在桌面弹出的窗口里选择文件夹…');
  try {
    const j = await post('/api/files/pick-folder');
    if (!j.ok) { toast(j.canceled ? '已取消' : (j.error || '没有选择')); return; }
    $('#file-root-input').value = j.path || '';
  } catch (e) { toast(e.message, 'error'); }
});
$('#btn-file-send').addEventListener('click', async () => {
  if (!fileState.selected) return toast('先选一个文件', 'error');
  try {
    const j = await post('/api/files/send-qq', { path: fileState.selected });
    toast('已发送到 QQ：' + (j.name || ''));
  } catch (e) { toast(e.message, 'error'); }
});

// ── 关于 ────────────────────────────────────────────────────
$('#link-bridge').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const j = await api('/api/open/bridge');
    window.open(j.url, '_blank');
  } catch (err) { toast(err.message, 'error'); }
});

// ── 启动 ────────────────────────────────────────────────────
const initialView = location.hash.replace(/^#/, '');
switchView(TITLES[initialView] ? initialView : 'overview', false);
window.addEventListener('hashchange', () => {
  const v = location.hash.replace(/^#/, '');
  if (TITLES[v] && v !== state.view) switchView(v, false);
});
refreshStatus();
setInterval(() => { if (!document.hidden) refreshStatus(); }, 4000);
setInterval(() => { if (!document.hidden && state.view === 'logs') loadLogs(); }, 5000);
setInterval(() => { if (!document.hidden && state.view === 'apps') loadPhone(); }, 15000);
setInterval(() => { if (!document.hidden && state.view === 'apps') loadPerception(); }, 5000);
