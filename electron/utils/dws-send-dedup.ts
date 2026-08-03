/**
 * dws 钉钉发送去重（进程内单例）。
 *
 * key = `recipientKey:contentHash`。挡 agent 连发两条完全相同的消息
 * （Claude send-guard PreToolUse / PostToolUse 读写本 Map）。
 */
import { createHash } from 'node:crypto';

/** 去重窗口。覆盖典型定时任务执行时长与观察到的 37s 连发间隔。 */
export const DWS_SEND_DEDUP_TTL_MS = 5 * 60 * 1000;

const recentSends = new Map<string, number>();

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function fingerprintKey(recipientKey: string, text: string): string {
  return `${recipientKey}:${contentHash(text)}`;
}

/** 由收件人类型 + id 构造稳定 key。 */
export function dwsSendRecipientKey(
  type: 'user' | 'group',
  id: string | undefined | null,
): string | null {
  const trimmed = id?.trim();
  if (!trimmed) return null;
  return `${type}:${trimmed}`;
}

export interface DwsSendDedupCheck {
  recent: boolean;
  /** recent=true 时的人类可读跳过原因。 */
  reason?: string;
}

/**
 * 判定是否在去重窗口内已向该收件人发过相同正文。
 * 命中过期记录会顺手清理，避免 Map 无界增长。
 */
export function checkDwsSendDedup(
  recipientKey: string | null,
  text: string,
  now: number = Date.now(),
): DwsSendDedupCheck {
  if (!recipientKey || !text) return { recent: false };
  const key = fingerprintKey(recipientKey, text);
  const sentAt = recentSends.get(key);
  if (sentAt == null) return { recent: false };
  if (now - sentAt >= DWS_SEND_DEDUP_TTL_MS) {
    recentSends.delete(key);
    return { recent: false };
  }
  const secs = Math.max(1, Math.ceil((DWS_SEND_DEDUP_TTL_MS - (now - sentAt)) / 1000));
  return {
    recent: true,
    reason: `[StoClaw 去重] 该收件人 ${secs}s 内已收到相同内容，跳过本次发送。`,
  };
}

/** 记录一次成功发送，供后续同正文发送命中去重。 */
export function recordDwsSent(
  recipientKey: string | null,
  text: string,
  now: number = Date.now(),
): void {
  if (!recipientKey || !text) return;
  recentSends.set(fingerprintKey(recipientKey, text), now);
}

/** 仅供测试重置。 */
export function resetDwsSendDedupForTests(): void {
  recentSends.clear();
}
