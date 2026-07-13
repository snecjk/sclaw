/**
 * dws 钉钉发送去重（进程内单例）。
 *
 * 用途：拦截「同一收件人在短窗口内收到完全相同正文」的重复发送。典型场景是
 * agent 自身对同一群/用户连发两条一模一样的消息（已观察到 37s 间隔，逃过了
 * send-guard 的 20s 频率限制）。key = `recipientKey:contentHash`，仅匹配**完全
 * 相同**的正文——不同正文的合法多次发送不受影响。
 *
 * 作用域：进程内 Map。定时任务路径下，Claude SDK 的 send-guard hook 与
 * claude-task-workflow-watchdog 的兜底发送同处 electron 主进程，共享本单例。
 * 跨进程的 OpenClaw 交互会话不共享，但交互会话无兜底发送，无此问题。
 *
 * 与既有去重的关系：
 * - `dingtalkAlreadySent`（worker onMessage）：挡 agent-vs-兜底（正文不同，本模块不覆盖）。
 * - `activeFallbacks`（workflowRunIds 指纹）：挡兜底-vs-兜底。
 * - 本模块：挡 agent-vs-agent（相同正文）以及任何路径的相同正文重发。
 */
import { createHash } from 'node:crypto';

/** 去重窗口。覆盖观察到的 37s 间隔与典型租约续期窗口；大于此间隔的相同正文允许重发。 */
export const DWS_SEND_DEDUP_TTL_MS = 5 * 60 * 1000;

const recentSends = new Map<string, number>();

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function fingerprintKey(recipientKey: string, text: string): string {
  return `${recipientKey}:${contentHash(text)}`;
}

/** 由收件人类型 + id 构造稳定 key（agent 解析的 --user/--group 与兜底的 recipient 共用此格式）。 */
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
