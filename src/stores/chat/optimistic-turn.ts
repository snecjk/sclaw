import { traceChatSession } from '../../../shared/chat-session-trace';
import { normalizeDerivedSessionLabel, isCorruptedSessionLabel } from '@/lib/workflow-session-hint';
import { shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import { dedupeRedundantUserMessages } from './user-message-merge';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage, SendMessageOptions } from './types';
import { rememberSkillMessageMeta } from '@/lib/skill-message-meta-cache';
import { useChatRuntimeV2Store } from './runtime-v2-store';

export function insertOptimisticUserTurn(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  displayText: string;
  gatewayMessage: string;
  attachments?: SendMessageOptions['attachments'];
  skillMeta?: SendMessageOptions['skillMeta'];
}): RawMessage {
  const {
    attachments,
    displayText,
    gatewayMessage,
    skillMeta,
    get,
    sessionKey,
    set,
  } = input;
  const nowMs = Date.now();
  const userMsg: RawMessage = {
    role: 'user',
    content: displayText || (attachments?.length ? '(file attached)' : ''),
    timestamp: nowMs / 1000,
    id: crypto.randomUUID(),
    _skillMeta: skillMeta,
    _attachedFiles: attachments?.map(a => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      preview: a.preview,
      filePath: a.stagedPath,
    })),
  };

  if (skillMeta && userMsg.id) {
    rememberSkillMessageMeta(sessionKey, userMsg.id, displayText, skillMeta, nowMs);
  }

  traceChatSession({
    phase: 'merge-optimistic',
    action: 'optimistic-insert',
    sessionKey,
    userMessageAt: nowMs,
    sending: true,
    optimisticId: userMsg.id,
    reason: 'sendMessage',
    detail: {
      displayLen: displayText.length,
      gatewayLen: gatewayMessage.length,
      idempotencyKey: userMsg.id,
    },
  });

  set((s) => (
    s.currentSessionKey === sessionKey ? {
      messages: dedupeRedundantUserMessages([...s.messages, userMsg], nowMs, {
        sessionKey,
      }),
    } : {}
  ));
  useChatRuntimeV2Store.getState().setOptimisticUserMessage(sessionKey, userMsg);

  const { sessionLabels, messages } = get();
  const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
  if (
    get().currentSessionKey === sessionKey
    &&
    !sessionKey.endsWith(':main')
    && isFirstMessage
    && shouldAutoDeriveSessionLabel(sessionKey, sessionLabels, isCorruptedSessionLabel)
    && (displayText || skillMeta?.title)
  ) {
    const normalized = normalizeDerivedSessionLabel(displayText || skillMeta?.title || '');
    if (normalized) {
      set((s) => ({
        sessionLabels: {
          ...s.sessionLabels,
          [sessionKey]: normalized,
        },
      }));
    }
  }

  set((s) => ({ sessionLastActivity: { ...s.sessionLastActivity, [sessionKey]: nowMs } }));

  return userMsg;
}
