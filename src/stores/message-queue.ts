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
import type { DingTalkMention } from '@/types/dingtalk-mention';

const QUEUE_MAX_PER_SESSION = 10;

export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  dingTalkMentions?: DingTalkMention[];
  workflowId?: string | null;
  queuedAt: number;
}

interface SessionQueue {
  queue: QueuedMessage[];
  isActive: boolean; // Whether this session's queue is being processed
}

interface MessageQueueState {
  queues: Map<string, SessionQueue>; // keyed by sessionKey
  enqueue: (sessionKey: string, text: string, attachments?: FileAttachment[], targetAgentId?: string | null, dingTalkMentions?: DingTalkMention[], workflowId?: string | null) => void;
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

  enqueue: (sessionKey, text, attachments, targetAgentId, dingTalkMentions, workflowId) => {
    const { queues } = get();
    const session = getOrCreateSessionQueue(queues, sessionKey);
    if (session.queue.length >= QUEUE_MAX_PER_SESSION) return;
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      attachments,
      targetAgentId,
      dingTalkMentions,
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
    const [item] = session.queue.splice(idx, 1);
    session.queue.splice(idx - 1, 0, item);
    set({ queues: new Map(queues) });
  },

  moveDown: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    const idx = session.queue.findIndex((m) => m.id === id);
    if (idx < 0 || idx >= session.queue.length - 1) return;
    const [item] = session.queue.splice(idx, 1);
    session.queue.splice(idx + 1, 0, item);
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
    const item = session.queue.shift()!;
    set({ queues: new Map(queues) });
    return item;
  },

  getQueue: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    return session?.queue ?? [];
  },

  getSessionQueue: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    return session ?? { queue: [], isActive: false };
  },

  setSessionActive: (sessionKey, active) => {
    const { queues } = get();
    const session = getOrCreateSessionQueue(queues, sessionKey);
    session.isActive = active;
    set({ queues: new Map(queues) });
  },
}));

export function createAutoSendWatcher(
  onAutoSend?: () => void,
) {
  let prevSending = false;

  const getSessionState = (sessionKey: string) => {
    const state = useChatStore.getState();
    return {
      sessionKey,
      sending: state.sending,
      error: state.error,
      messages: state.messages,
    };
  };

  const unsub = useChatStore.subscribe((state) => {
    const { sending, currentSessionKey } = state;
    const sessionQueue = useMessageQueueStore.getState().getSessionQueue(currentSessionKey);

    if (!sessionQueue.isActive || sessionQueue.queue.length === 0) return;

    const prevWasSending = prevSending;
    prevSending = sending;

    // When AI finishes responding (sending transitions from true to false),
    // dequeue and send the first queued message
    if (prevWasSending && !sending && sessionQueue.queue.length > 0) {
      const msg = useMessageQueueStore.getState().dequeueFirst(currentSessionKey);
      if (!msg) return;

      const chatState = useChatStore.getState();

      // Workflow queue: create and start workflow, then send message
      if (msg.workflowId) {
        import('@/hooks/use-workflow-send').then(({ sendWithWorkflow }) => {
          sendWithWorkflow(
            msg.text,
            msg.workflowId!,
            { sessionKey: currentSessionKey, agentId: chatState.currentAgentId },
            async (textToSend, runId, wfId, ctx) => {
              const wfCtx = ctx as import('@/stores/chat').WorkflowContextBlock | undefined;
              await chatState.sendMessage({
                text: textToSend,
                attachments: msg.attachments?.map((a) => ({
                  fileName: a.fileName,
                  mimeType: a.mimeType,
                  fileSize: a.fileSize,
                  stagedPath: a.stagedPath,
                  preview: a.preview,
                })),
                targetAgentId: msg.targetAgentId,
                dingTalkMentions: msg.dingTalkMentions,
                workflowId: wfId,
                runId,
                workflowContext: wfCtx,
              });
            },
          ).catch((err: unknown) => {
            console.error('[message-queue] workflow auto-send failed:', err);
            // Fall back to normal send so the message isn't lost
            chatState.sendMessage({
              text: msg.text,
              attachments: msg.attachments?.map((a) => ({
                fileName: a.fileName,
                mimeType: a.mimeType,
                fileSize: a.fileSize,
                stagedPath: a.stagedPath,
                preview: a.preview,
              })),
              targetAgentId: msg.targetAgentId,
              dingTalkMentions: msg.dingTalkMentions,
            });
          });
          return;
        });
        return;
      }

      onAutoSend?.();
      chatState.sendMessage({
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          fileSize: a.fileSize,
          stagedPath: a.stagedPath,
          preview: a.preview,
        })),
        targetAgentId: msg.targetAgentId,
        dingTalkMentions: msg.dingTalkMentions,
        workflowId: msg.workflowId,
      });
    } else {
      // No transition, just track state
    }
  });

  return () => {
    unsub();
  };
}
