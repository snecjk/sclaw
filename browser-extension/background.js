importScripts('cdp-allowlist.js', 'page-agent.js');

const DEFAULT_HOST = 'http://127.0.0.1:3210';
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const POLL_WAIT_MS = 20_000;
const HEARTBEAT_MS = 15_000;
const WAKE_ALARM = 'stoclaw-bridge-wake';
const LOOP_ALARM = 'stoclaw-bridge-loop';

/** @type {Map<number, { sessionId: string, groupId?: string, taskLabel?: string, marked: boolean, titlePrefix?: string }>} */
const tabSessions = new Map();
/** @type {Set<number>} */
const attachedTabs = new Set();
let token = '';
let hostBase = DEFAULT_HOST;
let versionMismatch = null;
let workTimer = null;
let heartbeatTimer = null;
let loopRunning = false;
let reconnectingToken = false;
/** @type {Set<number>} */
const pollLoops = new Set();

chrome.runtime.onInstalled.addListener(() => scheduleAlarms());
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
  void boot();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === WAKE_ALARM || alarm.name === LOOP_ALARM) {
    void onWake();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  tabSessions.delete(tabId);
  void detachDebugger(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const rec = tabSessions.get(tabId);
  if (!rec) return;
  if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) {
    void heartbeatTab(tabId, tab);
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handlePopupMessage(message).then(sendResponse);
  return true;
});

void boot();

function scheduleAlarms() {
  chrome.alarms.create(WAKE_ALARM, { periodInMinutes: 1 });
  try {
    chrome.alarms.create(LOOP_ALARM, { delayInMinutes: 0.02, periodInMinutes: 0.05 });
  } catch {
    chrome.alarms.create(LOOP_ALARM, { periodInMinutes: 1 });
  }
}

async function boot() {
  const stored = await chrome.storage.local.get(['token', 'hostBase', 'tabSessions']);
  token = typeof stored.token === 'string' ? stored.token : '';
  hostBase = typeof stored.hostBase === 'string' && stored.hostBase ? stored.hostBase : DEFAULT_HOST;
  if (stored.tabSessions && typeof stored.tabSessions === 'object') {
    for (const [key, value] of Object.entries(stored.tabSessions)) {
      tabSessions.set(Number(key), value);
    }
  }
  scheduleAlarms();
  if (!token) {
    await tryAutoConnect();
  } else {
    await refreshExtensionInfo();
  }
  startWorkLoop();
}

async function persistSessions() {
  const obj = {};
  for (const [tabId, rec] of tabSessions.entries()) obj[String(tabId)] = rec;
  await chrome.storage.local.set({ tabSessions: obj, token, hostBase });
}

async function tryAutoConnect() {
  if (versionMismatch) return { ok: false, error: versionMismatch };
  const info = await api('GET', '/api/browser-bridge/extension-info', null, { skipAuth: true });
  if (info.status === 503) {
    return { ok: false, error: 'Browser automation is disabled' };
  }
  const bundled = info.json && info.json.version;
  if (info.json && info.json.success && bundled) {
    const mismatch = majorMismatch(EXTENSION_VERSION, bundled);
    if (mismatch) {
      versionMismatch = 'BRIDGE_VERSION_MISMATCH';
      await chrome.storage.local.set({ versionMismatch: true, bundledVersion: bundled });
      stopWorkLoop();
      return { ok: false, error: 'BRIDGE_VERSION_MISMATCH' };
    }
    if (bundled !== EXTENSION_VERSION) {
      await chrome.storage.local.set({ updateAvailable: true, bundledVersion: bundled });
    }
  }
  const res = await api('POST', '/api/browser-bridge/auto-connect', { extensionVersion: EXTENSION_VERSION }, { skipAuth: true });
  if (res.json && res.json.success && res.json.token) {
    token = res.json.token;
    versionMismatch = null;
    await chrome.storage.local.set({ token, versionMismatch: false });
    return { ok: true };
  }
  if (res.json && res.json.error === 'BRIDGE_VERSION_MISMATCH') {
    versionMismatch = 'BRIDGE_VERSION_MISMATCH';
    await chrome.storage.local.set({ versionMismatch: true });
    stopWorkLoop();
    return { ok: false, error: 'BRIDGE_VERSION_MISMATCH' };
  }
  return { ok: false, error: (res.json && res.json.error) || 'Auto-connect failed' };
}

async function pairWithCode(pairingCode) {
  const res = await api('POST', '/api/browser-bridge/pair', { pairingCode }, { skipAuth: true });
  if (res.json && res.json.success && res.json.token) {
    token = res.json.token;
    versionMismatch = null;
    await chrome.storage.local.set({ token, versionMismatch: false });
    startWorkLoop();
    return { ok: true };
  }
  return { ok: false, error: (res.json && res.json.error) || 'Invalid pairing code' };
}

async function disconnectAll() {
  stopWorkLoop();
  token = '';
  tabSessions.clear();
  versionMismatch = null;
  for (const tabId of [...attachedTabs]) await detachDebugger(tabId);
  await chrome.storage.local.remove(['token', 'tabSessions', 'versionMismatch']);
}

async function connectActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id == null) return { ok: false, error: 'No active tab' };
  if (!token) {
    const auto = await tryAutoConnect();
    if (!auto.ok) return auto;
  }
  return connectTab(tab);
}

async function connectTab(tab) {
  const tabId = tab.id;
  if (tabId == null) return { ok: false, error: 'tabId missing' };
  if (isRestrictedTabUrl(tab.url || '')) {
    return { ok: false, error: '请先打开 http/https 页面。不能驱动 chrome:// 新标签页。' };
  }
  const existing = tabSessions.get(tabId);
  const sessionId = existing?.sessionId || `ext-${tabId}`;
  const body = {
    sessionId,
    tabId,
    url: tab.url || '',
    title: tab.title || '',
    extensionVersion: EXTENSION_VERSION,
    ownership: 'borrowed',
    groupId: existing?.groupId,
    taskLabel: existing?.taskLabel,
  };
  const res = await api('POST', '/api/browser-bridge/connect', body);
  if (res.status === 403 && isInvalidToken(res)) {
    const refreshed = await refreshTokenAndReconnect();
    if (!refreshed.ok) return refreshed;
    return connectTab(tab);
  }
  if (res.status === 403 && res.json && res.json.error === 'BRIDGE_VERSION_MISMATCH') {
    versionMismatch = 'BRIDGE_VERSION_MISMATCH';
    stopWorkLoop();
    return { ok: false, error: 'BRIDGE_VERSION_MISMATCH' };
  }
  if (!res.json || !res.json.success) {
    return { ok: false, error: (res.json && res.json.error) || `connect ${res.status}` };
  }
  tabSessions.set(tabId, {
    sessionId,
    groupId: existing?.groupId,
    taskLabel: existing?.taskLabel,
    marked: existing?.marked === true,
  });
  await persistSessions();
  startWorkLoop();
  startPollLoop(tabId);
  return { ok: true, sessionId };
}

async function refreshTokenAndReconnect() {
  if (reconnectingToken) return { ok: false, error: 'token refresh in progress' };
  reconnectingToken = true;
  try {
    const auto = await tryAutoConnect();
    if (!auto.ok) return auto;
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tabSessions.has(tab.id)) {
        await connectTab(tab);
      }
    }
    return { ok: true };
  } finally {
    reconnectingToken = false;
  }
}

function startWorkLoop() {
  if (loopRunning) {
    for (const tabId of tabSessions.keys()) startPollLoop(tabId);
    return;
  }
  loopRunning = true;
  for (const tabId of tabSessions.keys()) startPollLoop(tabId);
  const beat = async () => {
    if (!loopRunning || !token || versionMismatch) return;
    await heartbeatAll();
    heartbeatTimer = setTimeout(beat, HEARTBEAT_MS);
  };
  void beat();
}

function startPollLoop(tabId) {
  if (!loopRunning || pollLoops.has(tabId)) return;
  pollLoops.add(tabId);
  const run = async () => {
    try {
      while (loopRunning && token && !versionMismatch && tabSessions.has(tabId)) {
        const rec = tabSessions.get(tabId);
        if (!rec) break;
        await pollOne(tabId, rec);
      }
    } finally {
      pollLoops.delete(tabId);
    }
  };
  void run();
}

function stopWorkLoop() {
  loopRunning = false;
  if (workTimer) clearTimeout(workTimer);
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  workTimer = null;
  heartbeatTimer = null;
}

async function onWake() {
  if (!token || versionMismatch) {
    if (!token && !versionMismatch) await tryAutoConnect();
    return;
  }
  startWorkLoop();
  await heartbeatAll();
}

async function heartbeatAll() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id != null && tabSessions.has(tab.id)) {
      await heartbeatTab(tab.id, tab);
    }
  }
}

async function heartbeatTab(tabId, tab) {
  const rec = tabSessions.get(tabId);
  if (!rec) return;
  const res = await api('POST', '/api/browser-bridge/heartbeat', {
    sessionId: rec.sessionId,
    url: tab?.url,
    title: tab?.title,
  });
  if (res.status === 404) {
    await connectTab(tab || (await chrome.tabs.get(tabId)));
    return;
  }
  if (res.status === 403 && isInvalidToken(res)) {
    await refreshTokenAndReconnect();
  }
  if (res.status === 503) {
    stopWorkLoop();
  }
}

async function pollOne(tabId, rec) {
  const res = await api(
    'GET',
    `/api/browser-bridge/poll?sessionId=${encodeURIComponent(rec.sessionId)}&waitMs=${POLL_WAIT_MS}`,
  );
  if (res.status === 404) {
    try {
      await connectTab(await chrome.tabs.get(tabId));
    } catch {
      tabSessions.delete(tabId);
    }
    return;
  }
  if (res.status === 403 && isInvalidToken(res)) {
    await refreshTokenAndReconnect();
    return;
  }
  if (res.status === 503) {
    stopWorkLoop();
    return;
  }
  const commands = (res.json && res.json.commands) || [];
  for (const command of commands) {
    const result = await executeCommand(tabId, rec, command);
    await api('POST', '/api/browser-bridge/result', {
      sessionId: rec.sessionId,
      commandId: command.commandId,
      action: command.action,
      result,
    });
  }
}

async function executeCommand(tabId, rec, command) {
  const action = command.action;
  const payload = command.payload || {};
  try {
    switch (action) {
      case 'snapshot':
        return await cmdSnapshot(tabId, payload);
      case 'click':
        return await cmdClick(tabId, payload);
      case 'fill':
        return await cmdFill(tabId, payload);
      case 'navigate':
        return await cmdNavigate(tabId, payload);
      case 'screenshot':
        return await cmdScreenshot(tabId);
      case 'scroll':
        return await evaluateBridge(tabId, `window.__stoBridge.doScroll(${JSON.stringify(payload)})`);
      case 'evaluate':
        return await cmdEvaluate(tabId, payload);
      case 'read_page':
        return await evaluateBridge(tabId, 'window.__stoBridge.readPage()');
      case 'print_pdf':
        return { success: false, error: 'PRINT_PDF_UNSUPPORTED' };
      case 'cdp':
        return await cmdCdp(tabId, payload);
      case 'group_tabs':
        return await cmdGroupTabs(tabId, rec, payload);
      case 'mark_tabs':
        return await cmdMarkTabs(tabId, rec, payload);
      default:
        return { success: false, error: `Unsupported action: ${action}` };
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function cmdSnapshot(tabId, payload) {
  const mode = payload.mode === 'ax' ? 'ax' : 'dom';
  if (mode === 'ax') {
    try {
      const ax = await withDebugger(tabId, async () => {
        return chrome.debugger.sendCommand({ tabId }, 'Accessibility.getFullAXTree');
      });
      const nodes = Array.isArray(ax?.nodes) ? ax.nodes : [];
      if (nodes.length > 0) {
        return { success: true, mode: 'ax', tree: nodes, url: undefined, title: undefined, timestamp: Date.now() };
      }
    } catch {
      /* fall through to DOM */
    }
  }
  const tree = await evaluateBridge(tabId, 'window.__stoBridge.snapshot()');
  if (mode === 'ax') {
    return { success: true, mode: 'dom', unsupported: 'CDP_DOMAIN_UNSUPPORTED', ...tree };
  }
  return { success: true, mode: 'dom', ...tree, tree: tree.elements || [] };
}

async function cmdClick(tabId, payload) {
  await ensureAgent(tabId);
  await evaluateBridge(tabId, `window.__stoBridge.installClickProbe(${JSON.stringify(payload)})`);
  const jsResult = await evaluateBridge(tabId, `window.__stoBridge.jsClick(${JSON.stringify(payload)})`);
  if (!jsResult || jsResult.success === false) return jsResult || { success: false, error: 'click failed' };
  await sleep(50);
  let probe = await evaluateBridge(tabId, 'window.__stoBridge.readClickProbe()');
  const needFallback = jsResult.occluded === true || !probe || probe.delivered === false;
  if (needFallback && typeof jsResult.centerX === 'number' && typeof jsResult.centerY === 'number') {
    await evaluateBridge(tabId, `window.__stoBridge.installClickProbe(${JSON.stringify(payload)})`);
    await withDebugger(tabId, async () => {
      await dispatchMouseClick(tabId, jsResult.centerX, jsResult.centerY);
    });
    await sleep(50);
    probe = await evaluateBridge(tabId, 'window.__stoBridge.readClickProbe()');
  }
  if (probe && (!probe.delivered || probe.targetMatched === false)) {
    return {
      success: false,
      error: 'CLICK_NOT_DELIVERED',
      occluded: jsResult.occluded === true,
      occluder: jsResult.occluder,
    };
  }
  return {
    success: true,
    ref: payload.ref,
    stableKey: jsResult.stableKey,
    occluded: jsResult.occluded === true ? true : undefined,
  };
}

async function cmdFill(tabId, payload) {
  return evaluateBridge(tabId, `window.__stoBridge.nativeFill(${JSON.stringify(payload)})`);
}

async function cmdNavigate(tabId, payload) {
  const url = typeof payload.url === 'string' ? payload.url : '';
  if (!url) return { success: false, error: 'url is required' };
  await chrome.tabs.update(tabId, { url });
  await waitTabComplete(tabId, 15_000);
  const tab = await chrome.tabs.get(tabId);
  return { success: true, url: tab.url || url, title: tab.title || '' };
}

async function waitTabComplete(tabId, timeoutMs) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, timeoutMs);
    const onUpdated = (id, info) => {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function cmdScreenshot(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    /* tab may already be active or focused elsewhere */
  }
  await sleep(120);
  const captured = await withDebugger(tabId, async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
    return chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 60,
      fromSurface: true,
    });
  });
  const data = captured && typeof captured.data === 'string' ? captured.data : '';
  if (!data) return { success: false, error: 'SCREENSHOT_FAILED' };
  return {
    success: true,
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${data}`,
  };
}

async function cmdEvaluate(tabId, payload) {
  const expression = typeof payload.expression === 'string'
    ? payload.expression
    : (typeof payload.code === 'string' ? payload.code : '');
  if (!isAllowedEvaluate(expression)) {
    return { success: false, error: 'EVALUATE_NOT_ALLOWED' };
  }
  const value = await withDebugger(tabId, async () => {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    return result?.result?.value;
  });
  return { success: true, value };
}

function isAllowedEvaluate(expression) {
  const s = String(expression || '').trim();
  return /^(document\.(title|readyState)|location\.(href|pathname))$/.test(s);
}

async function cmdCdp(tabId, payload) {
  const method = typeof payload.method === 'string' ? payload.method : '';
  if (!isCdpMethodAllowed(method)) {
    return { success: false, error: 'CDP_METHOD_NOT_ALLOWED' };
  }
  const value = await withDebugger(tabId, async () => {
    return chrome.debugger.sendCommand({ tabId }, method, payload.params || {});
  });
  return { success: true, result: value };
}

async function cmdGroupTabs(tabId, rec, payload) {
  const title = typeof payload.title === 'string' && payload.title
    ? payload.title
    : (rec.taskLabel || 'StoClaw');
  const color = typeof payload.color === 'string' ? payload.color : 'orange';
  let tabIds = Array.isArray(payload.tabIds) ? payload.tabIds.filter((id) => typeof id === 'number') : [];
  if (tabIds.length === 0) {
    tabIds = [...tabSessions.keys()];
    if (!tabIds.includes(tabId)) tabIds.push(tabId);
  }
  try {
    const groups = await chrome.tabGroups.query({});
    const existing = groups.find((g) => g.title === title);
    let groupId;
    if (existing) {
      groupId = await chrome.tabs.group({ groupId: existing.id, tabIds });
    } else if (typeof payload.groupId === 'number') {
      groupId = await chrome.tabs.group({ groupId: payload.groupId, tabIds });
    } else {
      groupId = await chrome.tabs.group({ tabIds });
    }
    await chrome.tabGroups.update(groupId, { title, color });
    rec.groupId = String(groupId);
    rec.taskLabel = title;
    tabSessions.set(tabId, rec);
    await persistSessions();
    try {
      const tab = await chrome.tabs.get(tabId);
      await api('POST', '/api/browser-bridge/connect', {
        sessionId: rec.sessionId,
        tabId,
        url: tab.url || '',
        title: tab.title || '',
        extensionVersion: EXTENSION_VERSION,
        ownership: 'borrowed',
        groupId: rec.groupId,
        taskLabel: rec.taskLabel,
      });
    } catch {
      /* connect refresh is best-effort */
    }
    return { success: true, groupId: rec.groupId, title };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'tabGroups unavailable',
    };
  }
}

async function cmdMarkTabs(tabId, rec, payload) {
  const marked = payload.marked !== false;
  const label = typeof payload.label === 'string' ? payload.label : '[自动操作]';
  const result = await evaluateBridge(tabId, `window.__stoBridge.setVisualMark(${marked ? 'true' : 'false'}, ${JSON.stringify(label)})`);
  try {
    const tab = await chrome.tabs.get(tabId);
    const original = stripMarkPrefix(tab.title || '');
    if (marked) {
      await chrome.tabs.update(tabId, { title: undefined }).catch(() => {});
      await withDebugger(tabId, async () => {
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `document.title = ${JSON.stringify(`${label} ${original}`)}`,
          returnByValue: true,
        });
      });
    } else {
      await withDebugger(tabId, async () => {
        await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: `document.title = ${JSON.stringify(original)}`,
          returnByValue: true,
        });
      });
    }
  } catch {
    /* title prefix is a fallback */
  }
  rec.marked = marked;
  tabSessions.set(tabId, rec);
  await persistSessions();
  return result && result.success === false ? result : { success: true, marked };
}

function stripMarkPrefix(title) {
  return title.replace(/^\[自动操作\]\s*/, '').replace(/^\[.*?\]\s*/, '');
}

async function ensureAgent(tabId) {
  await withDebugger(tabId, async () => {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: PAGE_AGENT_SOURCE,
      returnByValue: true,
    });
  });
}

async function evaluateBridge(tabId, expression) {
  await ensureAgent(tabId);
  return withDebugger(tabId, async () => {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result?.result?.value;
  });
}

async function dispatchMouseClick(tabId, x, y) {
  const opts = { type: 'mousePressed', x, y, button: 'left', clickCount: 1 };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', opts);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    ...opts,
    type: 'mouseReleased',
  });
}

async function withDebugger(tabId, fn) {
  await attachDebugger(tabId);
  try {
    return await fn();
  } finally {
    /* keep attach for the command burst; detach when tab closes or after idle */
  }
}

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedTabs.add(tabId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already attached/i.test(message)) throw error;
    attachedTabs.add(tabId);
  }
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* ignore */
  }
  attachedTabs.delete(tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

function isRestrictedTabUrl(url) {
  return !url || /^(chrome|chrome-extension|edge|about|devtools):/i.test(url);
}

function isInvalidToken(res) {
  return res.json && String(res.json.error || '').toLowerCase().includes('invalid session token');
}

function majorMismatch(installed, bundled) {
  const a = String(installed).split('.')[0];
  const b = String(bundled).split('.')[0];
  return a !== b;
}

async function refreshExtensionInfo() {
  const info = await api('GET', '/api/browser-bridge/extension-info', null, { skipAuth: true });
  if (info.json && info.json.version && majorMismatch(EXTENSION_VERSION, info.json.version)) {
    versionMismatch = 'BRIDGE_VERSION_MISMATCH';
    stopWorkLoop();
  }
}

async function api(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (!opts.skipAuth && token) headers['X-Session-Token'] = token;
  if (body != null) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${hostBase}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return { status: 0, json: { success: false, error: error instanceof Error ? error.message : String(error) } };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handlePopupMessage(message) {
  const type = message && message.type;
  if (type === 'status') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const rec = tab && tab.id != null ? tabSessions.get(tab.id) : null;
    const stored = await chrome.storage.local.get(['updateAvailable', 'bundledVersion', 'versionMismatch']);
    return {
      connected: Boolean(token) && !versionMismatch,
      tokenPresent: Boolean(token),
      versionMismatch: Boolean(versionMismatch || stored.versionMismatch),
      updateAvailable: Boolean(stored.updateAvailable),
      installedVersion: EXTENSION_VERSION,
      bundledVersion: stored.bundledVersion || null,
      tabUrl: tab?.url || '',
      sessionId: rec?.sessionId || null,
      hostBase,
    };
  }
  if (type === 'autoConnect') return tryAutoConnect();
  if (type === 'pair') return pairWithCode(String(message.code || ''));
  if (type === 'connectTab') return connectActiveTab();
  if (type === 'disconnect') {
    await disconnectAll();
    return { ok: true };
  }
  if (type === 'setHost') {
    hostBase = String(message.hostBase || DEFAULT_HOST).replace(/\/$/, '');
    await chrome.storage.local.set({ hostBase });
    return { ok: true, hostBase };
  }
  return { ok: false, error: 'unknown message' };
}
