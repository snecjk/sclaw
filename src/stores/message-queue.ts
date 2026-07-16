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
import type { SkillMeta } from '@/types/skill-meta';

const QUEUE_MAX_PER_SESSION = 10;

/** Stable empty-array reference so `getQueue` selectors don't churn when a session has no queue. */
const EMPTY_QUEUE: QueuedMessage[] = [];

export interface QueuedMessage {
  id: string;
  text: string;
  attachments?: FileAttachment[];
  targetAgentId?: string | null;
  dingTalkMentions?: DingTalkMention[];
  workflowId?: string | null;
  skillMeta?: SkillMeta;
  queuedAt: number;
}

interface SessionQueue {
  queue: QueuedMessage[];
}

interface MessageQueueState {
  queues: Map<string, SessionQueue>; // keyed by sessionKey
  enqueue: (sessionKey: string, text: string, attachments?: FileAttachment[], targetAgentId?: string | null, dingTalkMentions?: DingTalkMention[], workflowId?: string | null, skillMeta?: SkillMeta) => void;
  remove: (sessionKey: string, id: string) => void;
  moveUp: (sessionKey: string, id: string) => void;
  moveDown: (sessionKey: string, id: string) => void;
  clear: (sessionKey: string) => void;
  clearAll: () => void;
  dequeueFirst: (sessionKey: string) => QueuedMessage | null;
  getQueue: (sessionKey: string) => QueuedMessage[];
  getSessionQueue: (sessionKey: string) => SessionQueue;
}

function getOrCreateSessionQueue(queues: Map<string, SessionQueue>, sessionKey: string): SessionQueue {
  if (!queues.has(sessionKey)) {
    queues.set(sessionKey, { queue: [] });
  }
  return queues.get(sessionKey)!;
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map(),

  enqueue: (sessionKey, text, attachments, targetAgentId, dingTalkMentions, workflowId, skillMeta) => {
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
      skillMeta,
      queuedAt: Date.now(),
    };
    // Immutable update: new array + new session object so `getQueue` selectors
    // see a changed reference and re-render (in-place push would not).
    queues.set(sessionKey, { queue: [...session.queue, item] });
    set({ queues: new Map(queues) });
  },

  remove: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    queues.set(sessionKey, { queue: session.queue.filter((m) => m.id !== id) });
    set({ queues: new Map(queues) });
  },

  moveUp: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    const idx = session.queue.findIndex((m) => m.id === id);
    if (idx <= 0) return;
    const next = [...session.queue];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    queues.set(sessionKey, { queue: next });
    set({ queues: new Map(queues) });
  },

  moveDown: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    const idx = session.queue.findIndex((m) => m.id === id);
    if (idx < 0 || idx >= session.queue.length - 1) return;
    const next = [...session.queue];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    queues.set(sessionKey, { queue: next });
    set({ queues: new Map(queues) });
  },

  clear: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session || session.queue.length === 0) return;
    queues.set(sessionKey, { queue: [] });
    set({ queues: new Map(queues) });
  },

  clearAll: () => {
    set({ queues: new Map() });
  },

  dequeueFirst: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session || session.queue.length === 0) return null;
    const [item, ...rest] = session.queue;
    queues.set(sessionKey, { queue: rest });
    set({ queues: new Map(queues) });
    return item;
  },

  getQueue: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    return session?.queue ?? EMPTY_QUEUE;
  },

  getSessionQueue: (sessionKey) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    return session ?? { queue: [] };
  },
}));

// ── Auto-send singleton ──────────────────────────────────────────────────────
// All surfaces (Chat page, Home, task subitems) share ONE chat-store
// subscription so a run finishing dequeues exactly one message, even when
// several `createAutoSendWatcher` callers are mounted at the same time.

type AutoSendCallback = () => void;

const autoSendCallbacks = new Set<AutoSendCallback>();
/** Sessions whose next "run finished" transition was caused by an explicit user abort. */
const suppressedSessions = new Set<string>();
let storeUnsub: (() => void) | null = null;
let watcherRefCount = 0;
let prevSending = false;

function mapQueuedAttachments(attachments?: FileAttachment[]) {
  return attachments?.map((a) => ({
    fileName: a.fileName,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
    stagedPath: a.stagedPath,
    preview: a.preview,
  }));
}

function deliverQueuedMessage(sessionKey: string, msg: QueuedMessage): void {
  const chatState = useChatStore.getState();

  // Workflow queue: create/start the workflow, then send through its context.
  if (msg.workflowId) {
    import('@/hooks/use-workflow-send')
      .then(({ sendWithWorkflow }) =>
        sendWithWorkflow(
          msg.text,
          msg.workflowId!,
          { sessionKey, agentId: chatState.currentAgentId },
          async (textToSend, runId, wfId, ctx) => {
            await chatState.sendMessage({
              text: textToSend,
              attachments: mapQueuedAttachments(msg.attachments),
              targetAgentId: msg.targetAgentId,
              dingTalkMentions: msg.dingTalkMentions,
              workflowId: wfId ?? undefined,
              runId: runId ?? undefined,
              workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
            });
          },
        ),
      )
      .catch((err: unknown) => {
        console.error('[message-queue] workflow auto-send failed:', err);
        // Fall back to a normal send so the message isn't lost.
        void chatState.sendMessage({
          text: msg.text,
          attachments: mapQueuedAttachments(msg.attachments),
          targetAgentId: msg.targetAgentId,
          dingTalkMentions: msg.dingTalkMentions,
          skillMeta: msg.skillMeta,
        });
      });
    return;
  }

  void chatState.sendMessage({
    text: msg.text,
    attachments: mapQueuedAttachments(msg.attachments),
    targetAgentId: msg.targetAgentId,
    dingTalkMentions: msg.dingTalkMentions,
    workflowId: msg.workflowId,
    skillMeta: msg.skillMeta,
  });
}

/**
 * Suppress the auto-send that would otherwise fire when the current run ends
 * because of an explicit user abort (Stop). Queued messages are kept and will
 * drain after the next successful run instead of firing right after Stop.
 *
 * Only meaningful while a run is active; otherwise the flag could linger and
 * wrongly suppress a future legitimate completion.
 */
export function suspendAutoSend(sessionKey?: string): void {
  const state = useChatStore.getState();
  if (!state.sending) return;
  suppressedSessions.add(sessionKey ?? state.currentSessionKey);
}

/**
 * Auto-send watcher. Drives "queue while running → auto-send when the run
 * finishes". Callers get a disposer; the underlying subscription is ref-counted
 * and shared across all callers.
 *
 * Rules:
 * - Fire only on a run finishing (sending: true → false).
 * - Skip (and consume) when the finish was an explicit user abort (Stop).
 * - Skip when the run failed (error set) — avoids cascading failures.
 * - Dequeue exactly one message per finish, sent serially.
 */
export function createAutoSendWatcher(onAutoSend?: AutoSendCallback): () => void {
  if (onAutoSend) autoSendCallbacks.add(onAutoSend);
  watcherRefCount += 1;

  if (!storeUnsub) {
    prevSending = useChatStore.getState().sending;
    storeUnsub = useChatStore.subscribe((state) => {
      const { sending, currentSessionKey, error } = state;
      const wasSending = prevSending;
      prevSending = sending;

      // Only react to a run finishing.
      if (!wasSending || sending) return;

      // Consume any abort suppression regardless of queue state so it never lingers.
      if (suppressedSessions.delete(currentSessionKey)) return;

      // Never chain-send after a failed run.
      if (error) return;

      const queueStore = useMessageQueueStore.getState();
      if (queueStore.getSessionQueue(currentSessionKey).queue.length === 0) return;

      const msg = queueStore.dequeueFirst(currentSessionKey);
      if (!msg) return;

      autoSendCallbacks.forEach((cb) => {
        try {
          cb();
        } catch {
          // Never let a UI callback (e.g. scroll) block auto-send.
        }
      });
      deliverQueuedMessage(currentSessionKey, msg);
    });
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (onAutoSend) autoSendCallbacks.delete(onAutoSend);
    watcherRefCount = Math.max(0, watcherRefCount - 1);
    if (watcherRefCount === 0 && storeUnsub) {
      storeUnsub();
      storeUnsub = null;
    }
  };
}
