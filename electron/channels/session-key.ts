import { randomUUID } from 'node:crypto';

export type PlatformChannelType = 'dingtalk' | 'mobile';

/**
 * 平台 Channel 会话键：
 * agent:{agentId}:{channelType}:{peerId}:{yyyyMMddHHmmss}:{nonce}
 *
 * OpenClaw Gateway 会对 sessionKey 做小写归一；peerId 也必须小写，
 * 否则 delivery 监听的 key 与 gateway-event 对不上，回程对不上。
 */
export function buildChannelSessionKey(
  channelType: PlatformChannelType,
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce = randomUUID().replace(/-/g, '').slice(0, 4),
): string {
  const safeChannel = channelType.trim().toLowerCase() as PlatformChannelType;
  if (safeChannel !== 'dingtalk' && safeChannel !== 'mobile') {
    throw new Error(`unsupported channelType: ${channelType}`);
  }
  const safeAgent = (agentId || 'main').trim().toLowerCase() || 'main';
  const safePeer = peerId.trim().replace(/:/g, '_').toLowerCase();
  if (!safePeer) {
    throw new Error(`peerId required for ${safeChannel} session key`);
  }
  const safeNonce = nonce.trim().replace(/:/g, '_').toLowerCase();
  if (!safeNonce) {
    throw new Error(`nonce required for ${safeChannel} session key`);
  }
  const timestamp = [
    startedAt.getUTCFullYear(),
    String(startedAt.getUTCMonth() + 1).padStart(2, '0'),
    String(startedAt.getUTCDate()).padStart(2, '0'),
    String(startedAt.getUTCHours()).padStart(2, '0'),
    String(startedAt.getUTCMinutes()).padStart(2, '0'),
    String(startedAt.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `agent:${safeAgent}:${safeChannel}:${safePeer}:${timestamp}:${safeNonce}`;
}

/** @deprecated 使用 buildChannelSessionKey('dingtalk', ...) */
export function buildDingTalkSessionKey(
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce = randomUUID().replace(/-/g, '').slice(0, 4),
): string {
  return buildChannelSessionKey('dingtalk', agentId, peerId, startedAt, nonce);
}

export function parseChannelSessionKey(sessionKey: string): {
  agentId: string;
  channelType: PlatformChannelType;
  peerId: string;
  startedAtToken: string | null;
} | null {
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[0] !== 'agent') return null;
  const channelType = parts[2];
  if (channelType !== 'dingtalk' && channelType !== 'mobile') return null;
  return {
    agentId: parts[1] || 'main',
    channelType,
    peerId: parts[3] || '',
    startedAtToken: parts[4] || null,
  };
}

export function parseDingTalkSessionKey(sessionKey: string): {
  agentId: string;
  peerId: string;
  startedAtToken: string | null;
} | null {
  const parsed = parseChannelSessionKey(sessionKey);
  if (!parsed || parsed.channelType !== 'dingtalk') return null;
  return {
    agentId: parsed.agentId,
    peerId: parsed.peerId,
    startedAtToken: parsed.startedAtToken,
  };
}
