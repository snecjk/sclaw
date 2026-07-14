/**
 * 平台 Channel 会话键：agent:{agentId}:dingtalk:{peerId}
 * peerId = 钉钉 conversationId（续聊粒度）。
 *
 * OpenClaw Gateway 会对 sessionKey 做小写归一；peerId 也必须小写，
 * 否则 delivery 监听的 key 与 gateway-event 对不上，钉钉侧收不到回程。
 */
export function buildDingTalkSessionKey(agentId: string, peerId: string): string {
  const safeAgent = (agentId || 'main').trim().toLowerCase() || 'main';
  const safePeer = peerId.trim().replace(/:/g, '_').toLowerCase();
  if (!safePeer) {
    throw new Error('peerId required for dingtalk session key');
  }
  return `agent:${safeAgent}:dingtalk:${safePeer}`;
}

export function parseDingTalkSessionKey(sessionKey: string): {
  agentId: string;
  peerId: string;
} | null {
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[0] !== 'agent' || parts[2] !== 'dingtalk') {
    return null;
  }
  return {
    agentId: parts[1] || 'main',
    peerId: parts.slice(3).join(':'),
  };
}
