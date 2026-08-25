const liveTurnKeys = new Set<string>();

function buildKey(sessionKey: string, turnIndex: number): string {
  return `${sessionKey.trim()}#${turnIndex}`;
}

/** 标记本轮 token 可在当前 renderer 生命周期内展示（刷新后 Set 清空，旧消息不显示）。 */
export function markLiveTurnToken(sessionKey: string, turnIndex: number): void {
  const normalized = sessionKey.trim();
  if (!normalized || turnIndex < 0) return;
  liveTurnKeys.add(buildKey(normalized, turnIndex));
}

export function isLiveTurnToken(sessionKey: string, turnIndex: number): boolean {
  const normalized = sessionKey.trim();
  if (!normalized || turnIndex < 0) return false;
  return liveTurnKeys.has(buildKey(normalized, turnIndex));
}
