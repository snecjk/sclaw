import { randomUUID } from 'node:crypto';

/**
 * 平台 Channel 会话键：
 * agent:{agentId}:dingtalk:{peerId}:{yyyyMMddHHmmss}:{nonce}
 *
 * OpenClaw Gateway 会对 sessionKey 做小写归一；peerId 也必须小写，
 * 否则 delivery 监听的 key 与 gateway-event 对不上，钉钉侧收不到回程。
 */
export function buildDingTalkSessionKey(
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce = randomUUID().replace(/-/g, '').slice(0, 4),
): string {
  const safeAgent = (agentId || 'main').trim().toLowerCase() || 'main';
  const safePeer = peerId.trim().replace(/:/g, '_').toLowerCase();
  if (!safePeer) {
    throw new Error('peerId required for dingtalk session key');
  }
  const safeNonce = nonce.trim().replace(/:/g, '_').toLowerCase();
  if (!safeNonce) {
    throw new Error('nonce required for dingtalk session key');
  }
  const timestamp = [
    startedAt.getUTCFullYear(),
    String(startedAt.getUTCMonth() + 1).padStart(2, '0'),
    String(startedAt.getUTCDate()).padStart(2, '0'),
    String(startedAt.getUTCHours()).padStart(2, '0'),
    String(startedAt.getUTCMinutes()).padStart(2, '0'),
    String(startedAt.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `agent:${safeAgent}:dingtalk:${safePeer}:${timestamp}:${safeNonce}`;
}

export function parseDingTalkSessionKey(sessionKey: string): {
  agentId: string;
  peerId: string;
  startedAtToken: string | null;
} | null {
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[0] !== 'agent' || parts[2] !== 'dingtalk') {
    return null;
  }
  return {
    agentId: parts[1] || 'main',
    peerId: parts[3] || '',
    startedAtToken: parts[4] || null,
  };
}
