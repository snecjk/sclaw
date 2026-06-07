/**
 * Message Queue Store
 * Manages pending message queues for multiple chat sessions.
 * Each session has its own independent queue, allowing parallel execution.
 * When the AI is responding, new user messages are queued here
 * and automatically sent one-by-one as each response completes.
 */
import { create } from 'zustand';
import { useChatStore } from './chat';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

const QUEUE_MAX_PER_SESSION = 10;

export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  workflowId?: string | null;
  queuedAt: number;
}

interface SessionQueue {
  queue: QueuedMessage[];
  isActive: boolean; // Whether this session's queue is being processed
}

interface MessageQueueState {
  queues: Map<string, SessionQueue>; // keyed by sessionKey
  enqueue: (sessionKey: string, text: string, attachments?: FileAttachment[], targetAgentId?: string | null, workflowId?: string | null) => void;
  remove: (sessionKey: string, id: string) => void;
  moveUp: (sessionKey: string, id: string) => void;
  moveDown: (sessionKey: string, id: string) => void;
  clear: (sessionKey: string) => void;
  clearAll: () => void;
  dequeueFirst: (sessionKey: string) => QueuedMessage | null;
  getQueue: (sessionKey: string) => QueuedMessage[];
  getSessionQueue: (sessionKey: string) => SessionQueue;
  setSessionActive: (sessionKey: string, active: boolean) => void;
}

function getOrCreateSessionQueue(queues: Map<string, SessionQueue>, sessionKey: string): SessionQueue {
  if (!queues.has(sessionKey)) {
    queues.set(sessionKey, { queue: [], isActive: false });
  }
  return queues.get(sessionKey)!;
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map(),

  enqueue: (sessionKey, text, attachments, targetAgentId, workflowId) => {
    const { queues } = get();
    const session = getOrCreateSessionQueue(queues, sessionKey);
    if (session.queue.length >= QUEUE_MAX_PER_SESSION) return;
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      attachments,
      targetAgentId,
      workflowId,
      queuedAt: Date.now(),
    };
    session.queue.push(item);
    set({ queues: new Map(queues) });
  },

  remove: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    session.queue = session.queue.filter((m) => m.id !== id);
    set({ queues: new Map(queues) });
  },

  moveUp: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    const idx = session.queue.findIndex((m) => m.id === id);
    if (idx <= 0) return;
    [session.queue[idx - 1], session.queue[idx]] = [session.queue[idx], session.queue[idx - 1]];
    set({ queues: new Map(queues) });
  },

  moveDown: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    const idx = session.queue.findIndex((m) => m.id === id);
    if (idx === -1 || idx >= session.queue.length - 1) return;
    [session.queue[idx], session.queue[idx + 1]] = [session.queue[idx + 1], session.queue[idx]];
    set({ queues: new Map(queues) });
  },

  clear: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    session.queue = [];
    set({ queues: new Map(queues) });
  },

  clearAll: () => {
    set({ queues: new Map() });
  },

  dequeueFirst: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session || session.queue.length === 0) return null;
    const [first, ...rest] = session.queue;
    session.queue = rest;
    set({ queues: new Map(queues) });
    return first;
  },

  getQueue: (sessionKey) => {
    const { queues } = get();
    return queues.get(sessionKey)?.queue || [];
  },

  getSessionQueue: (sessionKey) => {
    const { queues } = get();
    return getOrCreateSessionQueue(queues, sessionKey);
  },

  setSessionActive: (sessionKey, active) => {
    const { queues } = get();
    const session = getOrCreateSessionQueue(queues, sessionKey);
    session.isActive = active;
    set({ queues: new Map(queues) });
  },
}));

/**
 * Creates a watcher that auto-sends queued messages when the AI finishes responding.
 * Each session has its own independent queue, allowing parallel execution.
 * Call once from the Chat page component; returns an unsubscribe function.
 */
export function createAutoSendWatcher(
  onAutoSend?: () => void,
): () => void {
  // Track per-session state for parallel execution
  const sessionStates = new Map<string, { prevSending: boolean; timer: ReturnType<typeof setTimeout> | null }>();
  
  const getSessionState = (sessionKey: string) => {
    if (!sessionStates.has(sessionKey)) {
      // Initialize prevSending to false for new sessions to avoid false transitions
      sessionStates.set(sessionKey, { prevSending: false, timer: null });
    }
    return sessionStates.get(sessionKey)!;
  };

  const unsub = useChatStore.subscribe((state) => {
    const { sending, currentSessionKey, error } = state;
    const sessionState = getSessionState(currentSessionKey);

    // Detect sending: true → false transition for this session
    if (sessionState.prevSending && !sending) {
      sessionState.prevSending = sending;

      // Don't auto-send if there was an error
      if (error) return;

      const queue = useMessageQueueStore.getState().getQueue(currentSessionKey);
      if (queue.length === 0) return;

      // Small delay to let UI settle before sending next
      if (sessionState.timer) clearTimeout(sessionState.timer);
      sessionState.timer = setTimeout(() => {
        sessionState.timer = null;
        // Re-check state after delay
        const chatState = useChatStore.getState();
        if (chatState.sending || chatState.error) return;
        if (chatState.currentSessionKey !== currentSessionKey) return;

        const msg = useMessageQueueStore.getState().dequeueFirst(currentSessionKey);
        if (!msg) return;

        // If this queued message has a workflowId, process it through the workflow flow
        if (msg.workflowId) {
          console.log('[message-queue] auto-sending workflow message: workflowId=', msg.workflowId);
          const { sendWithWorkflow } = require('@/hooks/use-workflow-send') as typeof import('@/hooks/use-workflow-send');
          sendWithWorkflow(
            msg.text,
            msg.workflowId,
            { sessionKey: currentSessionKey, agentId: chatState.currentAgentId },
            async (text, runId, wfId) => {
              chatState.sendMessage(
                text,
                msg.attachments?.map((a) => ({
                  fileName: a.fileName,
                  mimeType: a.mimeType,
                  fileSize: a.fileSize,
                  stagedPath: a.stagedPath,
                  preview: a.preview,
                })),
                msg.targetAgentId,
                wfId,
                runId,
              );
            },
          ).catch((err: unknown) => {
            console.error('[message-queue] workflow auto-send failed:', err);
            // Fall back to normal send so the message isn't lost
            chatState.sendMessage(
              msg.text,
              msg.attachments?.map((a) => ({
                fileName: a.fileName,
                mimeType: a.mimeType,
                fileSize: a.fileSize,
                stagedPath: a.stagedPath,
                preview: a.preview,
              })),
              msg.targetAgentId,
              undefined,
            );
          });
          return;
        }

        onAutoSend?.();
        chatState.sendMessage(
          msg.text,
          msg.attachments?.map((a) => ({
            fileName: a.fileName,
            mimeType: a.mimeType,
            fileSize: a.fileSize,
            stagedPath: a.stagedPath,
            preview: a.preview,
          })),
          msg.targetAgentId,
          msg.workflowId,
        );
      }, 150);
    } else {
      sessionState.prevSending = sending;
    }
  });

  return () => {
    unsub();
    for (const [, state] of sessionStates) {
      if (state.timer) clearTimeout(state.timer);
    }
  };
}
