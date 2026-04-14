/**
 * Message Queue Store
 * Manages a pending message queue for the chat input.
 * When the AI is responding, new user messages are queued here
 * and automatically sent one-by-one as each response completes.
 */
import { create } from 'zustand';
import { useChatStore } from './chat';
import type { FileAttachment } from '@/pages/Chat/ChatInput';

const QUEUE_MAX = 10;

export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  queuedAt: number;
}

interface MessageQueueState {
  queue: QueuedMessage[];
  enqueue: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  remove: (id: string) => void;
  moveUp: (id: string) => void;
  moveDown: (id: string) => void;
  clear: () => void;
  dequeueFirst: () => QueuedMessage | null;
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queue: [],

  enqueue: (text, attachments, targetAgentId) => {
    const { queue } = get();
    if (queue.length >= QUEUE_MAX) return;
    const item: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      attachments,
      targetAgentId,
      queuedAt: Date.now(),
    };
    set({ queue: [...queue, item] });
  },

  remove: (id) => {
    set((s) => ({ queue: s.queue.filter((m) => m.id !== id) }));
  },

  moveUp: (id) => {
    set((s) => {
      const idx = s.queue.findIndex((m) => m.id === id);
      if (idx <= 0) return s;
      const next = [...s.queue];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return { queue: next };
    });
  },

  moveDown: (id) => {
    set((s) => {
      const idx = s.queue.findIndex((m) => m.id === id);
      if (idx === -1 || idx >= s.queue.length - 1) return s;
      const next = [...s.queue];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return { queue: next };
    });
  },

  clear: () => {
    set({ queue: [] });
  },

  dequeueFirst: () => {
    const { queue } = get();
    if (queue.length === 0) return null;
    const [first, ...rest] = queue;
    set({ queue: rest });
    return first;
  },
}));

/**
 * Creates a watcher that auto-sends queued messages when the AI finishes responding.
 * Call once from the Chat page component; returns an unsubscribe function.
 */
export function createAutoSendWatcher(
  onAutoSend?: () => void,
): () => void {
  let prevSending = useChatStore.getState().sending;
  let prevSessionKey = useChatStore.getState().currentSessionKey;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const unsub = useChatStore.subscribe((state) => {
    const { sending, currentSessionKey, error } = state;

    // Session changed — clear the queue
    if (currentSessionKey !== prevSessionKey) {
      prevSessionKey = currentSessionKey;
      useMessageQueueStore.getState().clear();
      prevSending = sending;
      return;
    }

    // Detect sending: true → false transition
    if (prevSending && !sending) {
      prevSending = sending;

      // Don't auto-send if there was an error
      if (error) return;

      const { queue } = useMessageQueueStore.getState();
      if (queue.length === 0) return;

      // Small delay to let UI settle before sending next
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        // Re-check state after delay
        const chatState = useChatStore.getState();
        if (chatState.sending || chatState.error) return;
        if (chatState.currentSessionKey !== currentSessionKey) return;

        const msg = useMessageQueueStore.getState().dequeueFirst();
        if (!msg) return;

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
        );
      }, 150);
    } else {
      prevSending = sending;
    }
  });

  return () => {
    unsub();
    if (pendingTimer) clearTimeout(pendingTimer);
  };
}
