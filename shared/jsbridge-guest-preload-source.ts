/**
 * Guest webview preload source (CommonJS).
 * Written to userData at runtime — avoids adding a separate Vite preload entry.
 */
export const JSBRIDGE_GUEST_PRELOAD_CJS = String.raw`/* sto-claw jsbridge guest preload */
const { contextBridge, ipcRenderer } = require('electron');

const PROTOCOL = 'stoclaw-bridge/v1';
const VERSION = '1.0.0';
const pending = new Map();
const eventListeners = new Map();

function getInit() {
  return typeof window.__STOCLAW_BRIDGE_INIT__ === 'object' && window.__STOCLAW_BRIDGE_INIT__
    ? window.__STOCLAW_BRIDGE_INIT__
    : null;
}

function dispatchEvent(name, payload) {
  const set = eventListeners.get(name);
  if (!set) return;
  for (const handler of set) {
    try { handler(payload); } catch (_) { /* ignore */ }
  }
}

ipcRenderer.on('jsbridge:response', (_event, response) => {
  if (!response || typeof response.id !== 'string') return;
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  clearTimeout(entry.timer);
  if (response.ok) entry.resolve(response.data);
  else {
    const err = new Error((response.error && response.error.message) || 'Bridge error');
    err.code = response.error && response.error.code;
    err.details = response.error && response.error.details;
    entry.reject(err);
  }
});

ipcRenderer.on('jsbridge:event', (_event, evt) => {
  if (!evt || typeof evt.name !== 'string') return;
  dispatchEvent(evt.name, evt.payload);
});

ipcRenderer.on('jsbridge:init', (_event, bootstrap) => {
  window.__STOCLAW_BRIDGE_INIT__ = bootstrap;
  dispatchEvent('bridge:ready', bootstrap);
});

function call(method, params, options) {
  const init = getInit();
  const timeoutMs = (options && options.timeoutMs) || 30000;
  return new Promise((resolve, reject) => {
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    const envelope = {
      protocol: PROTOCOL,
      version: VERSION,
      type: 'request',
      id,
      sessionId: (init && init.sessionId) || '',
      method,
      params,
      timestamp: Date.now(),
      userGesture: options && options.userGesture,
    };
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Bridge request timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ipcRenderer.sendToHost('jsbridge:request', envelope);
  });
}

function on(event, handler) {
  if (typeof handler !== 'function') return () => {};
  if (!eventListeners.has(event)) eventListeners.set(event, new Set());
  eventListeners.get(event).add(handler);
  return () => {
    const set = eventListeners.get(event);
    if (set) set.delete(handler);
  };
}

function off(event, handler) {
  const set = eventListeners.get(event);
  if (set && handler) set.delete(handler);
}

contextBridge.exposeInMainWorld('stoClaw', {
  getVersion: () => VERSION,
  call,
  invoke: call,
  on,
  off,
  getCapabilities: () => call('bridge.getCapabilities'),
});
`;
