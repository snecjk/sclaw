/** Treat `{ success: false }` as a real tool error, not a successful envelope. */

export function isFailedToolPayload(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { success?: unknown }).success === false,
  );
}

export function annotateFailedToolPayload(value: unknown): unknown {
  if (!isFailedToolPayload(value)) return value;
  const rec = value as Record<string, unknown>;
  if (typeof rec.actionHint === 'string' && rec.actionHint.trim()) return rec;
  const error = typeof rec.error === 'string' ? rec.error : '';
  const actionHint = error === 'SESSION_STALE' || /session not found/i.test(error)
    ? '会话已刷新。使用 currentSessionId 或省略 sessionId 再调一次；不要反复 list_sessions。'
    : '这是工具失败，不是页面「权限限制」。按 error 字段改参数或换 bridge_* / ba_*，不要编造权限话术。';
  return { ...rec, actionHint };
}

/**
 * 会话自愈必须对模型可见。
 *
 * 命令被改投到另一个会话却仍返回裸 `success:true` 时，模型会认为自己请求的那个
 * 会话是活的，于是继续拿错误 / 编造的 sessionId 重试——实测出现过同一个 ref
 * 连点 16 次、每次换一个不存在的 sessionId、每次都被判成功。
 */
export function annotateHealedSession(
  value: unknown,
  requestedSessionId: string | undefined,
  actualSessionId: string,
): unknown {
  if (!requestedSessionId || requestedSessionId === actualSessionId) return value;
  const note = `你请求的会话 ${requestedSessionId} 不存在，命令实际在 ${actualSessionId} 上执行。`
    + `后续调用请改用 ${actualSessionId} 或直接省略 sessionId；不要再猜测会话 ID。`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { result: value, healedSessionId: actualSessionId, requestedSessionId, actionHint: note };
  }
  return {
    ...(value as Record<string, unknown>),
    healedSessionId: actualSessionId,
    requestedSessionId,
    actionHint: note,
  };
}
