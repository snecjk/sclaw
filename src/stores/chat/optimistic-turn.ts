import { traceChatSession } from '../../../shared/chat-session-trace';
import { normalizeDerivedSessionLabel, isCorruptedSessionLabel } from '@/lib/workflow-session-hint';
import { shouldAutoDeriveSessionLabel } from '@/lib/session-label';
import { applyRuntimePatch } from './runtime-controller';
import { dedupeRedundantUserMessages } from './user-message-merge';
import type { ChatGet, ChatSet } from './store-api';
import type { RawMessage, SendMessageOptions } from './types';

export function insertOptimisticUserTurn(input: {
  get: ChatGet;
  set: ChatSet;
  sessionKey: string;
  displayText: string;
  gatewayMessage: string;
  attachments?: SendMessageOptions['attachments'];
}): RawMessage {
  const {
    attachments,
    displayText,
    gatewayMessage,
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
    _attachedFiles: attachments?.map(a => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
      preview: a.preview,
      filePath: a.stagedPath,
    })),
  };

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

  set((s) => ({
    messages: dedupeRedundantUserMessages([...s.messages, userMsg], nowMs, {
      sessionKey,
    }),
    ...applyRuntimePatch(s, sessionKey, {
      sending: true,
      activeRunId: null,
      sendAcceptance: null,
      streamingText: '',
      streamingMessage: null,
      streamingMessages: [],
      streamingToolResults: [],
      streamingTools: [],
      pendingFinal: false,
      lastUserMessageAt: nowMs,
      optimisticUserMessage: userMsg,
      pendingToolImages: [],
      error: null,
    }),
  }));

  const { sessionLabels, messages } = get();
  const isFirstMessage = !messages.slice(0, -1).some((m) => m.role === 'user');
  if (
    !sessionKey.endsWith(':main')
    && isFirstMessage
    && shouldAutoDeriveSessionLabel(sessionKey, sessionLabels, isCorruptedSessionLabel)
    && displayText
  ) {
    const normalized = normalizeDerivedSessionLabel(displayText);
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
