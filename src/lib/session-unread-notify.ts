import {
  canonicalSessionUnreadKey,
} from '@/lib/session-unread-keys';
import { useSessionUnreadStore } from '@/stores/session-unread';

/**
 * 运行成功收尾时打未读：仅非当前正在查看的会话。
 * 定时任务会话统一写入侧边栏可见的 dated aggregate key。
 *
 * @see docs/侧边栏改造-任务与最近.md §5.5
 */
export function markSessionUnreadAfterSuccessfulRun(
  sessionKey: string | null | undefined,
  currentSessionKey: string,
): void {
  if (!sessionKey) return;
  const canonical = canonicalSessionUnreadKey(sessionKey);
  if (!canonical || canonical === currentSessionKey) return;
  useSessionUnreadStore.getState().markSessionUnread(sessionKey);
}
