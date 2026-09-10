import { getIframeApplicationId } from './iframe-app-config';

export const IDENTITY_BRIDGE_PROTOCOL = 'sclaw:identity-bridge/v1' as const;

export type DeployEnv = 'daily' | 'stage' | 'online';

const TRUSTED_HOST_ENVIRONMENTS = new Map<string, DeployEnv>([
  ['https://zc-hybrid-test.sto.cn', 'daily'],
  ['https://pre-zc-hybrid.sto.cn', 'stage'],
  ['https://zc-hybrid.sto.cn', 'online'],
  ['http://zc-hybrid-dev.sto.cn:7001', 'daily'],
  ['https://zc-hybrid-dev.sto.cn:7001', 'daily'],
  ['http://localhost:7001', 'daily'],
]);

let hostOrigin: string | null = null;
let tokenPromise: Promise<string> | null = null;

function createRequestId(): string {
  return crypto.randomUUID?.() ?? `sclaw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveIframeDeployEnv(referrer = document.referrer): DeployEnv | null {
  try {
    return TRUSTED_HOST_ENVIRONMENTS.get(new URL(referrer).origin) ?? null;
  } catch {
    return null;
  }
}

export function initializeIframeTokenBridge(referrer = document.referrer): Promise<string> {
  if (window.parent === window) return Promise.reject(new Error('请从政策管家入口打开当前应用'));
  if (tokenPromise) return tokenPromise;

  const applicationId = getIframeApplicationId();
  const origin = new URL(referrer).origin;
  if (!TRUSTED_HOST_ENVIRONMENTS.has(origin)) {
    return Promise.reject(new Error(`不受信任的 iframe 宿主：${origin}`));
  }
  hostOrigin = origin;
  const requestId = createRequestId();
  tokenPromise = new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const message = data as Record<string, unknown>;
      if (message.protocolVersion !== IDENTITY_BRIDGE_PROTOCOL
        || message.requestId !== requestId || message.applicationId !== applicationId) return;
      if (message.type === 'sclaw:identity:error') {
        cleanup();
        reject(new Error('iframe 宿主身份不可用'));
        return;
      }
      const payload = message.payload as Record<string, unknown> | undefined;
      const token = typeof payload?.stoToken === 'string' ? payload.stoToken.trim() : '';
      if (message.type === 'sclaw:identity:response' && token) {
        cleanup();
        resolve(token);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('未收到 iframe 宿主身份信息，请从政策管家入口重新打开'));
    }, 5_000);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({
      type: 'sclaw:identity:request',
      protocolVersion: IDENTITY_BRIDGE_PROTOCOL,
      requestId,
      applicationId,
      capabilities: ['stoToken'],
    }, origin);
  }).catch((error) => {
    tokenPromise = null;
    throw error;
  });
  return tokenPromise;
}

export function getIframeStoToken(): Promise<string> {
  return tokenPromise ?? initializeIframeTokenBridge();
}

export function notifyHostTokenInvalid(): void {
  if (!hostOrigin || window.parent === window) return;
  window.parent.postMessage({
    type: 'sclaw:identity:invalid',
    protocolVersion: IDENTITY_BRIDGE_PROTOCOL,
    applicationId: getIframeApplicationId(),
    reason: 'UNAUTHORIZED',
  }, hostOrigin);
}
