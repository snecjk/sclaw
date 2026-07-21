import { type ChatSession, type SendMessageOptions, type WorkflowContextBlock } from './types';
import { resolveChatEngineType } from '@/lib/chat-engine-resolution';
import {
  resolveChatSessionEngineType,
  type ResolveChatSessionEngineTypeOptions,
} from '@/lib/resolve-chat-session-engine-type';
import { getAgentIdFromSessionKey } from './session-identity';

export function toMs(ts: unknown): number {
  if (typeof ts === 'string') {
    const numeric = Number(ts);
    if (Number.isFinite(numeric)) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 0;
  return ts < 1e12 ? ts * 1000 : ts;
}

export function getSessionEngineType(
  sessions: ChatSession[],
  sessionKey: string,
): ChatSession['engineType'] | undefined {
  return sessions.find((session) => session.key === sessionKey)?.engineType;
}

export function resolveEngineTypeForSession(
  sessions: ChatSession[],
  sessionKey: string,
  agentId: string | undefined | null,
  getAgentEngineType: (agentId: string | undefined | null) => ChatSession['engineType'] | undefined,
  options?: ResolveChatSessionEngineTypeOptions,
): ChatSession['engineType'] | undefined {
  return resolveChatSessionEngineType(
    sessions.find((session) => session.key === sessionKey),
    getAgentEngineType(agentId ?? getAgentIdFromSessionKey(sessionKey)),
    sessionKey,
    options,
  );
}

export function normalizeSendMessageOptions(args: unknown[]): SendMessageOptions {
  const [first, attachments, targetAgentId, workflowContext] = args;
  if (typeof first === 'string') {
    return {
      text: first,
      attachments: Array.isArray(attachments)
        ? attachments as SendMessageOptions['attachments']
        : undefined,
      targetAgentId: typeof targetAgentId === 'string' ? targetAgentId : undefined,
      workflowContext: workflowContext as WorkflowContextBlock | undefined,
    };
  }
  return first as SendMessageOptions;
}

export function parseSessionUpdatedAtMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return toMs(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export function getFallbackSessionEngineType(
  sessionKey: string,
  getAgentEngineType: (agentId: string | undefined | null) => ChatSession['engineType'] | undefined,
): ChatSession['engineType'] {
  return resolveChatEngineType({
    sessionKey,
    agentEngineType: getAgentEngineType(getAgentIdFromSessionKey(sessionKey)),
    defaultSessionUsesAgent: true,
    sessionEngineFirst: false,
    inferOpenClawTaskKeys: true,
  });
}
