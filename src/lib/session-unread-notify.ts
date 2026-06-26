import { useSessionUnreadStore } from '@/stores/session-unread';

/**
 * 运行成功收尾时打未读：仅非当前正在查看的会话。
 * 入参传入 currentSessionKey，避免本模块 import chat store（gateway ↔ chat 循环依赖）。
 *
 * @see docs/侧边栏改造-任务与最近.md §5.5
 */
export function markSessionUnreadAfterSuccessfulRun(
  sessionKey: string | null | undefined,
  currentSessionKey: string,
): void {
  if (!sessionKey || sessionKey === currentSessionKey) return;
  useSessionUnreadStore.getState().markSessionUnread(sessionKey);
}
