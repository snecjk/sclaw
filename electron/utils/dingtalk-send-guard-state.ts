import { createHash } from 'node:crypto';
import {
  clearDingTalkMentionPending,
  readDingTalkMentionPending,
} from './dingtalk-mention-pending';
import type {
  DingTalkPendingContext,
  DingTalkSendReservation,
  DingTalkSendReservationInput,
} from '../agent-extensions/extensions/sto-dingtalk-send-guard/capability';

const SEND_INTERVAL_MS = 20_000;
const DEDUP_TTL_MS = 5 * 60 * 1000;

const lastInitiatedAt = new Map<string, number>();
const recentSuccessfulSends = new Map<string, number>();
const pendingReservations = new Map<string, {
  fingerprint?: string;
}>();
const pendingContextLocks = new Map<string, Promise<unknown>>();

function rateKey(sessionKey: string, category: string): string {
  return `${sessionKey.trim() || '__global__'}:${category}`;
}

function reservationKey(sessionKey: string, toolCallId: string): string {
  return `${sessionKey.trim() || '__global__'}:${toolCallId}`;
}

function fingerprint(recipientKey: string | undefined, text: string | undefined): string | undefined {
  const recipient = recipientKey?.trim();
  const normalizedText = text?.trim();
  if (!recipient || !normalizedText) return undefined;
  const hash = createHash('sha256').update(normalizedText).digest('hex').slice(0, 16);
  return `${recipient}:${hash}`;
}

function cleanExpired(now: number): void {
  for (const [key, sentAt] of recentSuccessfulSends) {
    if (now - sentAt >= DEDUP_TTL_MS) recentSuccessfulSends.delete(key);
  }
}

export async function consumeDingTalkPendingContext(
  sessionKey: string,
): Promise<DingTalkPendingContext | null> {
  const previous = pendingContextLocks.get(sessionKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  pendingContextLocks.set(sessionKey, queued);
  await previous;
  try {
    const pending = await readDingTalkMentionPending(sessionKey);
    if (!pending) return null;
    await clearDingTalkMentionPending(sessionKey);
    return pending;
  } finally {
    release();
    if (pendingContextLocks.get(sessionKey) === queued) pendingContextLocks.delete(sessionKey);
  }
}

/** Checks pending mention context without consuming a valid entry. */
export async function hasDingTalkPendingContext(sessionKey: string): Promise<boolean> {
  return Boolean(await readDingTalkMentionPending(sessionKey));
}

export function reserveDingTalkSend(
  input: DingTalkSendReservationInput,
): DingTalkSendReservation {
  const now = input.now ?? Date.now();
  cleanExpired(now);
  const sendFingerprint = fingerprint(input.recipientKey, input.normalizedText);
  if (sendFingerprint) {
    const sentAt = recentSuccessfulSends.get(sendFingerprint);
    if (sentAt != null && now - sentAt < DEDUP_TTL_MS) {
      const seconds = Math.max(1, Math.ceil((DEDUP_TTL_MS - (now - sentAt)) / 1000));
      return {
        allowed: false,
        code: 'duplicate',
        reason: `[SClaw 去重] 该收件人 ${seconds}s 内已收到相同内容，跳过本次发送。`,
      };
    }
  }

  if (!input.scheduledExecution) {
    const key = rateKey(input.sessionKey, input.category);
    const last = lastInitiatedAt.get(key);
    if (last != null && now - last < SEND_INTERVAL_MS) {
      const seconds = Math.max(1, Math.ceil((SEND_INTERVAL_MS - (now - last)) / 1000));
      const label = input.category === 'text' ? '文字' : '图片';
      return {
        allowed: false,
        code: 'rate_limited',
        reason: `[SClaw 安全策略] 钉钉${label}消息发送过于频繁，请 ${seconds} 秒后再试（每 20 秒最多 1 条${label}消息）。这是频控、不是权限拒绝——你被允许发送。请等待约 ${seconds} 秒后用原命令重试，不要放弃、不要让用户手动发送。`,
      };
    }
    lastInitiatedAt.set(key, now);
  }
  pendingReservations.set(reservationKey(input.sessionKey, input.toolCallId), {
    fingerprint: sendFingerprint,
  });
  return { allowed: true };
}

export function completeDingTalkSend(input: {
  sessionKey: string;
  toolCallId: string;
  success: boolean;
  now?: number;
}): void {
  const key = reservationKey(input.sessionKey, input.toolCallId);
  const pending = pendingReservations.get(key);
  pendingReservations.delete(key);
  if (input.success && pending?.fingerprint) {
    recentSuccessfulSends.set(pending.fingerprint, input.now ?? Date.now());
  }
}

export function resetDingTalkSendGuardStateForTests(): void {
  lastInitiatedAt.clear();
  recentSuccessfulSends.clear();
  pendingReservations.clear();
  pendingContextLocks.clear();
}
