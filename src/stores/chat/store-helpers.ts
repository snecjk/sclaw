import { DEFAULT_SESSION_KEY, type ChatSession, type RawMessage, type SendMessageOptions, type WorkflowContextBlock } from './types';
import {
  isAnyCronSessionKey,
  isClaudeScheduledTaskDatedSessionKey,
  isClaudeScheduledTaskRunSessionKey,
  isClaudeScheduledTaskSessionKey,
  isScheduledTaskSessionKey,
} from './cron-session-utils';
import { getAgentIdFromSessionKey } from './session-identity';

export function stripAgentMemoryFromHistoryMessage(
  message: RawMessage,
  stripText: (text: string) => string,
): RawMessage {
  if (message.role !== 'user') {
    return message;
  }

  if (typeof message.content === 'string') {
    const stripped = stripText(message.content);
    return stripped === message.content ? message : { ...message, content: stripped };
  }

  if (!Array.isArray(message.content)) {
    return message;
  }

  let changed = false;
  const content = message.content.map((block) => {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      return block;
    }
    const stripped = stripText(block.text);
    if (stripped === block.text) {
      return block;
    }
    changed = true;
    return { ...block, text: stripped };
  });

  return changed ? { ...message, content } : message;
}

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

export function toNumberIfFinite(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
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
): ChatSession['engineType'] | undefined {
  if (sessionKey === DEFAULT_SESSION_KEY) {
    return getAgentEngineType(agentId ?? getAgentIdFromSessionKey(sessionKey));
  }
  if (isClaudeScheduledTaskSessionKey(sessionKey)
    || isClaudeScheduledTaskRunSessionKey(sessionKey)
    || isClaudeScheduledTaskDatedSessionKey(sessionKey)) {
    return 'claude';
  }
  return getSessionEngineType(sessions, sessionKey)
    ?? getAgentEngineType(agentId ?? getAgentIdFromSessionKey(sessionKey));
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
  if (isClaudeScheduledTaskSessionKey(sessionKey)
    || isClaudeScheduledTaskRunSessionKey(sessionKey)
    || isClaudeScheduledTaskDatedSessionKey(sessionKey)) {
    return 'claude';
  }
  if (isAnyCronSessionKey(sessionKey) || isScheduledTaskSessionKey(sessionKey)) {
    return 'openclaw';
  }
  return getAgentEngineType(getAgentIdFromSessionKey(sessionKey)) ?? 'openclaw';
}
