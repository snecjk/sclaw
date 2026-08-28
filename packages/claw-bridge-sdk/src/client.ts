import { StoClawBridgeError, wrapNativeError } from './errors';
import type {
  AppGetInfoResult,
  AuthGetAuthModeResult,
  BridgeSubscribeResult,
  CallOptions,
  ChatCancelParams,
  ChatCancelResult,
  ChatCompleteParams,
  ChatCompleteResult,
  ChatFillComposerParams,
  ChatOpenSessionParams,
  ChatSendMessageParams,
  NavJumpParams,
  NavOpenAppParams,
  NavOpenTabParams,
  StoClawBridgeNative,
  UiAlertParams,
  UiConfirmParams,
  UiConfirmResult,
  UiOpenDrawerParams,
  UiToastParams,
  UserGetInfoResult,
} from './types';
import { BRIDGE_AI_DEFAULT_TIMEOUT_MS } from './types';

function resolveNativeBridge(): StoClawBridgeNative {
  if (typeof window === 'undefined') {
    throw new StoClawBridgeError('BRIDGE_UNAVAILABLE', 'stoClaw bridge is only available in browser');
  }
  const bridge = window.stoClaw;
  if (!bridge?.call) {
    throw new StoClawBridgeError(
      'BRIDGE_UNAVAILABLE',
      'window.stoClaw is not available — open this page inside SClaw webview (*.sto.cn)',
    );
  }
  return bridge;
}

async function callNative<T>(
  method: string,
  params?: unknown,
  options?: CallOptions,
): Promise<T> {
  const bridge = resolveNativeBridge();
  try {
    const fn = bridge.invoke ?? bridge.call;
    return (await fn.call(bridge, method, params, options)) as T;
  } catch (error) {
    throw wrapNativeError(error);
  }
}

/** Ref-count host subscriptions per event name (multiple addListener on same event). */
const subscriptionRefCounts = new Map<string, number>();

function normalizeEventList(events: string | string[]): string[] {
  const list = Array.isArray(events) ? events : [events];
  const out: string[] = [];
  for (const item of list) {
    const trimmed = item.trim();
    if (!trimmed || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

async function bumpSubscription(event: string, delta: number): Promise<void> {
  const prev = subscriptionRefCounts.get(event) ?? 0;
  const next = prev + delta;
  if (next <= 0) {
    subscriptionRefCounts.delete(event);
    if (prev > 0) {
      await callNative<BridgeSubscribeResult>('bridge.unsubscribe', { events: [event] });
    }
    return;
  }
  subscriptionRefCounts.set(event, next);
  if (prev === 0) {
    await callNative<BridgeSubscribeResult>('bridge.subscribe', { events: [event] });
  }
}

export class StoClawBridgeClient {
  /** Raw bridge invoke — method names follow stoclaw-bridge/v1 registry. */
  call<T = unknown>(method: string, params?: unknown, options?: CallOptions): Promise<T> {
    return callNative<T>(method, params, options);
  }

  getVersion(): string {
    return resolveNativeBridge().getVersion?.() ?? '1.0.0';
  }

  getCapabilities(): Promise<string[]> {
    const bridge = resolveNativeBridge();
    if (bridge.getCapabilities) return bridge.getCapabilities();
    return callNative<string[]>('bridge.getCapabilities');
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    return resolveNativeBridge().on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    resolveNativeBridge().off?.(event, handler);
  }

  /** Register interest with the host (required before events are delivered). */
  subscribe(events: string | string[]): Promise<BridgeSubscribeResult> {
    const list = normalizeEventList(events);
    if (list.length === 0) {
      return Promise.resolve({ subscribed: [] });
    }
    return callNative<BridgeSubscribeResult>('bridge.subscribe', { events: list });
  }

  /** Remove host subscriptions. Omit events to clear all. */
  unsubscribe(events?: string | string[]): Promise<BridgeSubscribeResult> {
    const list = events ? normalizeEventList(events) : undefined;
    if (!list?.length) {
      for (const event of [...subscriptionRefCounts.keys()]) {
        subscriptionRefCounts.delete(event);
      }
      return callNative<BridgeSubscribeResult>('bridge.unsubscribe', {});
    }
    for (const event of list) {
      subscriptionRefCounts.delete(event);
    }
    return callNative<BridgeSubscribeResult>('bridge.unsubscribe', { events: list });
  }

  /**
   * Subscribe + local listener in one call. Cleanup unsubscribes from host
   * when the last ref-counted listener for that event is removed.
   */
  async addListener<T = unknown>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<() => void> {
    await bumpSubscription(event, 1);
    const offLocal = this.on(event, handler as (payload: unknown) => void);
    return () => {
      offLocal();
      void bumpSubscription(event, -1);
    };
  }

  // ── 1. 用户信息 ──

  getUserInfo(): Promise<UserGetInfoResult> {
    return callNative<UserGetInfoResult>('user.getInfo');
  }

  getAuthMode(): Promise<AuthGetAuthModeResult> {
    return callNative<AuthGetAuthModeResult>('auth.getAuthMode');
  }

  getAppInfo(): Promise<AppGetInfoResult> {
    return callNative<AppGetInfoResult>('app.getInfo');
  }

  // ── 2. 统一 UI ──

  toast(params: UiToastParams): Promise<{ ok: boolean }> {
    return callNative('ui.toast', params);
  }

  alert(params: UiAlertParams): Promise<{ ok: boolean }> {
    return callNative('ui.alert', params);
  }

  confirm(params: UiConfirmParams): Promise<UiConfirmResult> {
    return callNative<UiConfirmResult>('ui.confirm', params);
  }

  openDrawer(params: UiOpenDrawerParams = { kind: 'chat' }): Promise<{ ok: boolean }> {
    return callNative('ui.openDrawer', params);
  }

  // ── 3. 跳转 ──

  jump(params: NavJumpParams): Promise<unknown> {
    return callNative('nav.jump', params);
  }

  openWebview(params: NavOpenTabParams): Promise<{ ok: boolean }> {
    return callNative('nav.openTab', params);
  }

  openApp(params: NavOpenAppParams): Promise<unknown> {
    return callNative('nav.openApp', params);
  }

  // ── 4 & 5. 会话回填 / 新会话 ──

  fillComposer(params: ChatFillComposerParams): Promise<unknown> {
    return callNative('chat.fillComposer', params);
  }

  openSession(params: ChatOpenSessionParams): Promise<unknown> {
    return callNative('chat.openSession', params);
  }

  sendMessage(params: ChatSendMessageParams): Promise<unknown> {
    return callNative('chat.sendMessage', params);
  }

  toggleChatPanel(): Promise<{ ok: boolean }> {
    return callNative('chat.togglePanel');
  }

  // ── 6. Headless AI（Text prompt + JSON context → Text / JSON） ──

  /**
   * One-shot Agent invocation without opening the chat panel.
   * Sets default `timeoutMs` and ensures the bridge IPC timeout exceeds the agent budget.
   */
  complete(params: ChatCompleteParams, options?: CallOptions): Promise<ChatCompleteResult> {
    const timeoutMs = params.timeoutMs ?? BRIDGE_AI_DEFAULT_TIMEOUT_MS;
    return callNative<ChatCompleteResult>(
      'chat.complete',
      { ...params, timeoutMs },
      {
        ...options,
        timeoutMs: options?.timeoutMs ?? timeoutMs + 5_000,
      },
    );
  }

  /** Cancel an in-flight {@link complete} call by `requestId`. */
  cancel(params: ChatCancelParams, options?: CallOptions): Promise<ChatCancelResult> {
    return callNative<ChatCancelResult>('chat.cancel', params, options);
  }

  ping(): Promise<{ pong: boolean; timestamp: number }> {
    return callNative('bridge.ping');
  }
}

let singleton: StoClawBridgeClient | null = null;

/** Singleton SDK instance bound to window.stoClaw preload. */
export function getStoClaw(): StoClawBridgeClient {
  if (!singleton) singleton = new StoClawBridgeClient();
  return singleton;
}

/** Shorthand export — same as getStoClaw(). */
export const stoClaw = getStoClaw();

/** True when running inside SClaw webview with bridge preload injected. */
export function isStoClawBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.stoClaw?.call);
}
