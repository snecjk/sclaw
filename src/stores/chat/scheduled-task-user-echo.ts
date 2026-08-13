import { normalizeUserMessageForDisplay } from '@/lib/user-message-display';
import { getMessageText, toMs } from './helpers';
import type { RawMessage } from './types';

const SCHEDULED_ECHO_EARLY_SKEW_MS = 2_000;
const SCHEDULED_ECHO_LATE_WINDOW_MS = 120_000;

/**
 * 定时任务每次运行通常使用相同 prompt。除稳定 id 外，只有当前 run 时间窗内的
 * 同文 user 记录才能视为 optimistic 回显；旧 run 的同文消息不能清除当前分隔行。
 */
export function isScheduledTaskUserEcho(
  candidate: RawMessage,
  optimistic: RawMessage,
  referenceMs: number,
): boolean {
  if (candidate.role !== 'user') return false;
  if (candidate.id && optimistic.id && candidate.id === optimistic.id) return true;
  if (!Number.isFinite(referenceMs) || referenceMs <= 0) return false;

  const candidateMs = typeof candidate.timestamp === 'number'
    ? toMs(candidate.timestamp)
    : Number.NaN;
  if (
    !Number.isFinite(candidateMs)
    || candidateMs < referenceMs - SCHEDULED_ECHO_EARLY_SKEW_MS
    || candidateMs > referenceMs + SCHEDULED_ECHO_LATE_WINDOW_MS
  ) {
    return false;
  }

  const candidateText = normalizeUserMessageForDisplay(getMessageText(candidate.content));
  const optimisticText = normalizeUserMessageForDisplay(getMessageText(optimistic.content));
  return candidateText.length > 0 && candidateText === optimisticText;
}
