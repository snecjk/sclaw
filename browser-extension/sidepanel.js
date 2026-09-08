const $ = (id) => document.getElementById(id);

/** @type {{ role: 'user' | 'assistant' | 'status'; text: string }} */
let messages = [];
let afterSequence = 0;
let activeRunId = null;
let pollGeneration = 0;
let sending = false;

function mergeStreamText(previous, next) {
  if (!next) return previous;
  if (!previous) return next;
  return next.startsWith(previous) ? next : previous + next;
}

function renderMessages() {
  const list = $('messages');
  list.replaceChildren();
  for (const item of messages) {
    const li = document.createElement('li');
    li.className = item.role === 'user' ? 'user' : item.role === 'status' ? 'status-line' : 'assistant';
    li.textContent = item.text;
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

function setStatus(text) {
  $('status').textContent = text || '';
}

function setBusy(busy) {
  sending = busy;
  $('send').disabled = busy;
  $('prompt').disabled = busy;
  $('stop').hidden = !busy;
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  const mismatch = Boolean(status.versionMismatch);
  $('mismatch').hidden = !mismatch;
  $('disconnected').hidden = mismatch || status.connected;
  $('connected').hidden = mismatch || !status.connected;
  $('connection').textContent = mismatch
    ? '版本不匹配'
    : status.connected
      ? '已连接本机 SClaw'
      : '未连接本机 SClaw';
  if (mismatch) {
    $('mismatch-versions').textContent = `已安装 ${status.installedVersion}，SClaw 内置 ${status.bundledVersion || '?'}`;
  }
  $('tab-url').textContent = status.tabUrl || '(无标签)';
  const restricted = /^(chrome|chrome-extension|edge|about|devtools):/i.test(status.tabUrl || '');
  $('restricted').hidden = !restricted;
  $('versions').textContent = `扩展 ${status.installedVersion}`
    + (status.bundledVersion ? ` · Host ${status.bundledVersion}` : '')
    + (status.sessionId ? ` · ${status.sessionId}` : '');
  $('update').hidden = !status.updateAvailable || mismatch;
  return status;
}

async function hostFetch(method, path, body, query) {
  const stored = await chrome.storage.local.get(['token', 'hostBase']);
  const hostBase = (stored.hostBase || 'http://127.0.0.1:3210').replace(/\/$/, '');
  const token = typeof stored.token === 'string' ? stored.token : '';
  const url = new URL(`${hostBase}${path}`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  const headers = { Accept: 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  if (body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function applyEvents(events) {
  if (!Array.isArray(events)) return false;
  let terminal = false;
  for (const event of events) {
    if (typeof event.sequence === 'number') {
      afterSequence = Math.max(afterSequence, event.sequence);
    }
    if (event.type === 'message.delta' || event.type === 'message.final') {
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') {
        messages.push({ role: 'assistant', text: event.text || '' });
      } else {
        last.text = mergeStreamText(last.text, event.text || '');
      }
    } else if (event.type === 'tool.updated' && event.toolName) {
      messages.push({ role: 'status', text: `工具 ${event.toolName}` });
    } else if (event.type === 'run.failed' || event.type === 'run.interrupted') {
      messages.push({ role: 'status', text: event.error || '本轮失败' });
      terminal = true;
    } else if (event.type === 'run.completed' || event.type === 'run.aborted') {
      terminal = true;
    }
  }
  renderMessages();
  return terminal;
}

async function pollEvents(generation) {
  while (generation === pollGeneration) {
    const res = await hostFetch('GET', '/api/browser-bridge/agent-events', null, {
      waitMs: 20000,
      afterSequence,
    });
    if (generation !== pollGeneration) return;
    if (res.status === 403) {
      setStatus((res.json && res.json.error) || '未授权');
      setBusy(false);
      return;
    }
    const terminal = applyEvents(res.json && res.json.events);
    if (terminal) {
      setBusy(false);
      setStatus('');
      return;
    }
  }
}

async function sendPrompt(prompt) {
  setBusy(true);
  setStatus('发送中…');
  const connected = await chrome.runtime.sendMessage({ type: 'connectTab' });
  if (!connected || !connected.ok) {
    setBusy(false);
    setStatus((connected && connected.error) || '无法接管当前标签');
    return;
  }
  const status = await refresh();
  messages.push({ role: 'user', text: prompt });
  renderMessages();
  const res = await hostFetch('POST', '/api/browser-bridge/agent-turn', {
    prompt,
    tabId: status.tabId,
    url: status.tabUrl,
    title: status.tabTitle,
  });
  if (!res.json || !res.json.success) {
    setBusy(false);
    setStatus((res.json && (res.json.message || res.json.error)) || `发送失败 ${res.status}`);
    return;
  }
  afterSequence = typeof res.json.afterSequence === 'number' ? res.json.afterSequence : afterSequence;
  activeRunId = res.json.runId || null;
  setStatus('等待回复…');
  const generation = ++pollGeneration;
  await pollEvents(generation);
}

$('auto-connect').addEventListener('click', async () => {
  setStatus('连接中…');
  const result = await chrome.runtime.sendMessage({ type: 'autoConnect' });
  setStatus(result.ok ? '已拿到 token' : (result.error || '失败'));
  await refresh();
});

$('pair').addEventListener('click', async () => {
  const code = $('pairing-code').value.trim();
  setStatus('配对中…');
  const result = await chrome.runtime.sendMessage({ type: 'pair', code });
  setStatus(result.ok ? '配对成功' : (result.error || '失败'));
  await refresh();
});

$('disconnect').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  setStatus('已断开');
  await refresh();
});

$('stop').addEventListener('click', async () => {
  pollGeneration += 1;
  await hostFetch('POST', '/api/browser-bridge/agent-abort', { runId: activeRunId });
  setBusy(false);
  setStatus('已停止');
});

$('composer').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (sending) return;
  const prompt = $('prompt').value.trim();
  if (!prompt) return;
  $('prompt').value = '';
  try {
    await sendPrompt(prompt);
  } catch (error) {
    setBusy(false);
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

void refresh();
setInterval(() => { void refresh(); }, 4000);
