import { createHostEventSource } from './host-api';

let eventSource: EventSource | null = null;

const HOST_EVENT_TO_IPC_CHANNEL: Record<string, string> = {
  'gateway:status': 'gateway:status-changed',
  'gateway:error': 'gateway:error',
  'chat-runtime:event': 'chat-runtime:event',
  'chat:result-open': 'chat:result-open',
  'workflow:status-update': 'workflow:status-update',
  'workflow:event': 'workflow:event',
  'workflow-runtime:recover': 'workflow-runtime:recover',
  'workflow:completion-open': 'workflow:completion-open',
  'gateway:channel-status': 'gateway:channel-status',
  'gateway:exit': 'gateway:exit',
  'oauth:code': 'oauth:code',
  'oauth:success': 'oauth:success',
  'oauth:error': 'oauth:error',
  'sto:models-synced': 'sto:models-synced',
  'sto:appearance-state': 'sto:appearance-state',
  'skills:changed': 'skills:changed',
  'turn-token:updated': 'turn-token:updated',
  'channel:wechat-qr': 'channel:wechat-qr',
  'channel:wechat-success': 'channel:wechat-success',
  'channel:wechat-error': 'channel:wechat-error',
  'channel:dingtalk-bind-replaced': 'channel:dingtalk-bind-replaced',
};

function getEventSource(): EventSource {
  if (!eventSource) {
    eventSource = createHostEventSource();
  }
  return eventSource;
}

function allowSseFallback(): boolean {
  try {
    return window.localStorage.getItem('stoclaw:allow-sse-fallback') === '1';
  } catch {
    return false;
  }
}

export function subscribeHostEvent<T = unknown>(
  eventName: string,
  handler: (payload: T) => void,
): () => void {
  const ipc = window.electron?.ipcRenderer;
  const ipcChannel = HOST_EVENT_TO_IPC_CHANNEL[eventName];
  if (ipcChannel && ipc?.on && ipc?.off) {
    const listener = (payload: unknown) => {
      handler(payload as T);
    };
    const unsubscribe = ipc.on(ipcChannel, listener);
    if (typeof unsubscribe === 'function') return unsubscribe;

    // Compatibility fallback for older preload bridges that did not return
    // the exact wrapped Electron listener cleanup function.
    return () => {
      ipc.off(ipcChannel, listener);
    };
  }

  if (!allowSseFallback()) {
    console.warn(`[host-events] no IPC mapping for event "${eventName}", SSE fallback disabled`);
    return () => {};
  }

  const source = getEventSource();
  const listener = (event: Event) => {
    const payload = JSON.parse((event as MessageEvent).data) as T;
    handler(payload);
  };
  source.addEventListener(eventName, listener);
  return () => {
    source.removeEventListener(eventName, listener);
  };
}
