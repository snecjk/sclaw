import { buildDingTalkSessionKey } from './session-key';

const DINGTALK_SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000;

const NEW_SESSION_COMMANDS = new Set([
  '新对话',
  '新会话',
  '清空上下文',
  '/new',
  '/reset',
]);

export function buildNewDingTalkSessionKey(
  agentId: string,
  peerId: string,
  startedAt = new Date(),
  nonce?: string,
): string {
  return buildDingTalkSessionKey(agentId, peerId, startedAt, nonce);
}

export function shouldStartNewDingTalkSession(input: {
  nowMs: number;
  lastActivityAt?: string | null;
  forceNew?: boolean;
}): boolean {
  if (input.forceNew) return true;
  if (!input.lastActivityAt) return true;
  const lastActivityMs = Date.parse(input.lastActivityAt);
  if (!Number.isFinite(lastActivityMs)) return true;
  return input.nowMs - lastActivityMs >= DINGTALK_SESSION_IDLE_TTL_MS;
}

export function resolveDingTalkSessionKey(input: {
  agentId: string;
  peerId: string;
  now?: Date;
  latestSession?: {
    sessionKey: string;
    lastActivityAt?: string | null;
  } | null;
  forceNew?: boolean;
  nonce?: string;
}): string {
  const now = input.now ?? new Date();
  if (
    input.latestSession
    && !shouldStartNewDingTalkSession({
      nowMs: now.getTime(),
      lastActivityAt: input.latestSession.lastActivityAt,
      forceNew: input.forceNew,
    })
  ) {
    return input.latestSession.sessionKey;
  }
  return buildNewDingTalkSessionKey(
    input.agentId,
    input.peerId,
    now,
    input.nonce,
  );
}

export function isDingTalkNewSessionCommand(text: string): boolean {
  return NEW_SESSION_COMMANDS.has(text.trim().toLowerCase());
}
