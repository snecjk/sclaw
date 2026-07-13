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

/** Stable empty-array reference so `getQueue` selectors don't churn when a session has no queue. */
const EMPTY_QUEUE: QueuedMessage[] = [];

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
}

interface MessageQueueState {
  queues: Map<string, SessionQueue>; // keyed by sessionKey
  enqueue: (sessionKey: string, text: string, attachments?: FileAttachment[], targetAgentId?: string | null, dingTalkMentions?: DingTalkMention[], workflowId?: string | null) => void;
  remove: (sessionKey: string, id: string) => void;
  updateText: (sessionKey: string, id: string, text: string) => void;
  takeById: (sessionKey: string, id: string) => QueuedMessage | null;
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

  updateText: (sessionKey, id, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return;
    queues.set(sessionKey, {
      queue: session.queue.map((item) => (item.id === id ? { ...item, text: trimmed } : item)),
    });
    set({ queues: new Map(queues) });
  },

  takeById: (sessionKey, id) => {
    const { queues } = get();
    const session = queues.get(sessionKey);
    if (!session) return null;
    const item = session.queue.find((m) => m.id === id) ?? null;
    if (!item) return null;
    queues.set(sessionKey, { queue: session.queue.filter((m) => m.id !== id) });
    set({ queues: new Map(queues) });
    return item;
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
const prevSendingByKey = new Map<string, boolean>();

function isSessionSending(
  sessionKey: string,
  state: ReturnType<typeof useChatStore.getState>,
): boolean {
  const isCurrent = state.currentSessionKey === sessionKey;
  const runtime = state.runtimeBySessionKey[sessionKey];
  return Boolean(
    runtime?.sending
    || runtime?.activeRunId
    || (isCurrent && (state.sending || state.activeRunId)),
  );
}

function sessionRunError(
  sessionKey: string,
  state: ReturnType<typeof useChatStore.getState>,
): string | null | undefined {
  const isCurrent = state.currentSessionKey === sessionKey;
  const runtime = state.runtimeBySessionKey[sessionKey];
  if (isCurrent) return state.error;
  return runtime?.error;
}

function collectWatchedSessionKeys(state: ReturnType<typeof useChatStore.getState>): string[] {
  const keys = new Set<string>([state.currentSessionKey, ...Object.keys(state.runtimeBySessionKey)]);
  for (const sessionKey of useMessageQueueStore.getState().queues.keys()) {
    keys.add(sessionKey);
  }
  return [...keys].filter(Boolean);
}

function tryDrainSessionQueue(sessionKey: string, onAutoSend?: AutoSendCallback): void {
  const queueStore = useMessageQueueStore.getState();
  if (queueStore.getSessionQueue(sessionKey).queue.length === 0) return;
  const msg = queueStore.dequeueFirst(sessionKey);
  if (!msg) return;
  if (onAutoSend) {
    try {
      onAutoSend();
    } catch {
      // Never let a UI callback block auto-send.
    }
  } else {
    autoSendCallbacks.forEach((cb) => {
      try {
        cb();
      } catch {
        // Never let a UI callback block auto-send.
      }
    });
  }
  deliverQueuedMessage(sessionKey, msg);
}

async function abortSessionRun(sessionKey: string): Promise<void> {
  const chatState = useChatStore.getState();
  if (!isSessionSending(sessionKey, chatState)) return;

  if (chatState.currentSessionKey === sessionKey) {
    await chatState.abortRun();
    return;
  }

  const { resolveEngineTypeForSession } = await import('@/stores/chat/helpers');
  const { useGatewayStore } = await import('@/stores/gateway');
  useChatStore.setState((state) => ({
    runtimeBySessionKey: {
      ...state.runtimeBySessionKey,
      [sessionKey]: {
        ...(state.runtimeBySessionKey[sessionKey] ?? {}),
        sending: false,
        activeRunId: null,
        streamingText: '',
        streamingMessage: null,
        streamingMessages: [],
        streamingToolResults: [],
        streamingTools: [],
        pendingFinal: false,
        lastUserMessageAt: null,
        pendingToolImages: [],
      },
    },
  }));
  try {
    await useGatewayStore.getState().rpc('chat.abort', {
      sessionKey,
      engineType: resolveEngineTypeForSession(
        chatState.sessions,
        sessionKey,
        chatState.currentAgentId,
      ),
    });
  } catch (err) {
    console.warn('[message-queue] background abort failed:', err);
  }
}

/**
 * Abort the active run for a session and immediately send a queued item.
 * Does NOT call suspendAutoSend — distinct from the Stop button path.
 */
export async function sendImmediately(sessionKey: string, itemId: string): Promise<boolean> {
  const item = useMessageQueueStore.getState().takeById(sessionKey, itemId);
  if (!item) return false;
  await abortSessionRun(sessionKey);
  deliverQueuedMessage(sessionKey, item);
  return true;
}

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
    storeUnsub = useChatStore.subscribe((state) => {
      for (const sessionKey of collectWatchedSessionKeys(state)) {
        const sending = isSessionSending(sessionKey, state);
        const wasSending = prevSendingByKey.get(sessionKey) ?? false;
        prevSendingByKey.set(sessionKey, sending);
        if (!wasSending || sending) continue;
        if (suppressedSessions.delete(sessionKey)) continue;
        if (sessionRunError(sessionKey, state)) continue;
        tryDrainSessionQueue(sessionKey);
      }
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
