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
import type { PersistedComposerSegment } from '@/lib/dingtalk-mention-composer';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { SkillMeta } from '@/types/skill-meta';
import { getAgentIdFromSessionKey } from './chat/session-identity';
import { useChatRuntimeV2Store } from './chat/runtime-v2-store';
import { buildChatSessionRuntimeView } from './chat/runtime-selectors';
import type { ModelMessageCompositionV1 } from '../../shared/model-message-composition';
import { buildModelCompositionFromPersistedSegments } from '../../shared/model-message-composition';

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
  skillMetas?: SkillMeta[];
  workflows?: Array<{ id: string; name: string; source?: string }>;
  composerSegments?: PersistedComposerSegment[];
  gatewayText?: string;
  composition?: ModelMessageCompositionV1;
  queuedAt: number;
}

interface SessionQueue {
  queue: QueuedMessage[];
}

interface MessageQueueState {
  queues: Map<string, SessionQueue>; // keyed by sessionKey
  enqueue: (
    sessionKey: string,
    text: string,
    attachments?: FileAttachment[],
    targetAgentId?: string | null,
    dingTalkMentions?: DingTalkMention[],
    workflowId?: string | null,
    skillMeta?: SkillMeta,
    extras?: {
      skillMetas?: SkillMeta[];
      workflows?: Array<{ id: string; name: string; source?: string }>;
      composerSegments?: PersistedComposerSegment[];
      gatewayText?: string;
      composition?: ModelMessageCompositionV1;
    },
  ) => void;
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

type MentionSegment = Extract<PersistedComposerSegment, { type: 'mention' }>;

/**
 * 以编辑后的新文本为准重建 text/mention 序列：文本里仍存在的 `@displayName`
 * 还原为 mention 段（否则文本段会被 renderUserMessageMentionNodes 正则再渲染一次，
 * 与保留的 mention 段双重显示）；文本里已被删掉的 @ 直接丢弃（不再发 DING）。
 */
function rebuildTextAndMentionSegments(
  text: string,
  mentionSegments: MentionSegment[],
): PersistedComposerSegment[] {
  const unused = [...mentionSegments];
  const out: PersistedComposerSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last?.type === 'text') {
      last.text += value;
    } else {
      out.push({ type: 'text', text: value });
    }
  };

  let rest = text;
  while (rest) {
    let hit: MentionSegment | null = null;
    let hitIndex = -1;
    let hitNeedle = '';
    for (const seg of unused) {
      const needle = `@${seg.mention.displayName}`;
      const index = rest.indexOf(needle);
      if (index !== -1 && (hitIndex === -1 || index < hitIndex)) {
        hit = seg;
        hitIndex = index;
        hitNeedle = needle;
      }
    }
    if (!hit) break;
    pushText(rest.slice(0, hitIndex));
    out.push(hit);
    unused.splice(unused.indexOf(hit), 1);
    rest = rest.slice(hitIndex + hitNeedle.length);
  }
  pushText(rest);
  return out;
}

/**
 * 编辑队列文本后同步 segments：技能/工作流/文件 chip 原样保留（不在编辑文本中）；
 * 首个 text/mention 段位置替换为按新文本重建的 text/mention 序列，其余旧
 * text/mention 段丢弃，避免发送后气泡残留旧文案或 mention 双重渲染。
 */
function replaceQueueItemTextSegments(
  segments: QueuedMessage['composerSegments'],
  text: string,
): QueuedMessage['composerSegments'] {
  if (!segments?.length) return segments;
  const mentionSegments = segments.filter(
    (seg): seg is MentionSegment => seg.type === 'mention',
  );
  const inline = rebuildTextAndMentionSegments(text, mentionSegments);
  let inlinePlaced = false;
  const next: PersistedComposerSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'text' || seg.type === 'mention') {
      if (!inlinePlaced) {
        next.push(...inline);
        inlinePlaced = true;
      }
      continue;
    }
    next.push(seg);
  }
  if (!inlinePlaced) next.unshift(...inline);
  return next;
}

/** 文本里仍保留 `@displayName` 的 mention 才保留；被删掉的 @ 不再发 DING。 */
function filterQueueItemMentionsByText(
  mentions: QueuedMessage['dingTalkMentions'],
  text: string,
): QueuedMessage['dingTalkMentions'] {
  if (!mentions?.length) return mentions;
  const kept = mentions.filter((mention) => text.includes(`@${mention.displayName}`));
  return kept.length === mentions.length ? mentions : kept;
}

function rebuildQueueComposition(
  segments: QueuedMessage['composerSegments'],
  attachments: QueuedMessage['attachments'],
): ModelMessageCompositionV1 | undefined {
  if (!segments?.length) return undefined;
  return buildModelCompositionFromPersistedSegments({
    segments,
    media: attachments ?? [],
    appendUnmatchedMedia: true,
  });
}

export const useMessageQueueStore = create<MessageQueueState>((set, get) => ({
  queues: new Map(),

  enqueue: (sessionKey, text, attachments, targetAgentId, dingTalkMentions, workflowId, skillMeta, extras) => {
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
      skillMetas: extras?.skillMetas,
      workflows: extras?.workflows,
      composerSegments: extras?.composerSegments,
      gatewayText: extras?.gatewayText,
      composition: extras?.composition,
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
      queue: session.queue.map((item) => {
        if (item.id !== id || item.text === trimmed) return item;
        const composerSegments = replaceQueueItemTextSegments(item.composerSegments, trimmed);
        return {
          ...item,
          text: trimmed,
          // 文本已改：入队时的预烘焙 gateway 文本随之过期，置空后
          // 投递时走 sendMessage 的现烘焙路径（技能前缀/工作流句按新文本重建）。
          gatewayText: undefined,
          composerSegments,
          composition: rebuildQueueComposition(composerSegments, item.attachments),
          dingTalkMentions: filterQueueItemMentionsByText(item.dingTalkMentions, trimmed),
        };
      }),
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
): boolean {
  return buildChatSessionRuntimeView(
    useChatRuntimeV2Store.getState().sessionsByKey[sessionKey],
  ).sending;
}

function sessionRunError(
  sessionKey: string,
): string | null | undefined {
  return buildChatSessionRuntimeView(
    useChatRuntimeV2Store.getState().sessionsByKey[sessionKey],
  ).error;
}

function collectWatchedSessionKeys(): string[] {
  const keys = new Set<string>([
    useChatStore.getState().currentSessionKey,
    ...Object.keys(useChatRuntimeV2Store.getState().sessionsByKey),
  ]);
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

async function abortSessionRun(sessionKey: string): Promise<boolean> {
  const chatState = useChatStore.getState();
  if (!isSessionSending(sessionKey)) return true;
  return await chatState.abortRun(sessionKey);
}

/**
 * Abort the active run for a session and immediately send a queued item.
 * Suppresses the normal completion drain for this one transition so the
 * explicitly selected item is delivered exactly once after abort succeeds.
 */
export async function sendImmediately(sessionKey: string, itemId: string): Promise<boolean> {
  const item = useMessageQueueStore.getState().getQueue(sessionKey).find((entry) => entry.id === itemId);
  if (!item) return false;
  const wasSending = isSessionSending(sessionKey);
  if (wasSending) suppressedSessions.add(sessionKey);
  const stopped = await abortSessionRun(sessionKey);
  // The true→false transition consumes this flag synchronously. Delete it as a
  // fallback when abort failed or another terminal path completed first.
  suppressedSessions.delete(sessionKey);
  if (!stopped) return false;
  const dequeued = useMessageQueueStore.getState().takeById(sessionKey, itemId);
  if (!dequeued) return false;
  deliverQueuedMessage(sessionKey, dequeued);
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
          {
            sessionKey,
            agentId: msg.targetAgentId ?? getAgentIdFromSessionKey(sessionKey) ?? chatState.currentAgentId,
          },
          async (textToSend, runId, wfId, ctx) => {
            await chatState.sendMessage({
              text: textToSend,
              sessionKey,
              gatewayText: msg.gatewayText,
              composition: msg.composition,
              attachments: mapQueuedAttachments(msg.attachments),
              targetAgentId: msg.targetAgentId,
              dingTalkMentions: msg.dingTalkMentions,
              workflowId: wfId ?? undefined,
              runId: runId ?? undefined,
              workflowContext: ctx as import('@/stores/chat').WorkflowContextBlock | undefined,
              skillMeta: msg.skillMeta,
              skillMetas: msg.skillMetas,
              workflows: msg.workflows,
              composerSegments: msg.composerSegments,
            });
          },
        ),
      )
      .catch((err: unknown) => {
        console.error('[message-queue] workflow auto-send failed:', err);
        // Fall back to a normal send so the message isn't lost.
        void chatState.sendMessage({
          text: msg.text,
          sessionKey,
          gatewayText: msg.gatewayText,
          composition: msg.composition,
          attachments: mapQueuedAttachments(msg.attachments),
          targetAgentId: msg.targetAgentId,
          dingTalkMentions: msg.dingTalkMentions,
          skillMeta: msg.skillMeta,
          skillMetas: msg.skillMetas,
          workflows: msg.workflows,
          composerSegments: msg.composerSegments,
        });
      });
    return;
  }

  void chatState.sendMessage({
    text: msg.text,
    sessionKey,
    gatewayText: msg.gatewayText,
    composition: msg.composition,
    attachments: mapQueuedAttachments(msg.attachments),
    targetAgentId: msg.targetAgentId,
    dingTalkMentions: msg.dingTalkMentions,
    workflowId: msg.workflowId,
    skillMeta: msg.skillMeta,
    skillMetas: msg.skillMetas,
    workflows: msg.workflows,
    composerSegments: msg.composerSegments,
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
  const targetSessionKey = sessionKey ?? state.currentSessionKey;
  if (!isSessionSending(targetSessionKey)) return;
  suppressedSessions.add(targetSessionKey);
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
    storeUnsub = useChatRuntimeV2Store.subscribe(() => {
      for (const sessionKey of collectWatchedSessionKeys()) {
        const sending = isSessionSending(sessionKey);
        const wasSending = prevSendingByKey.get(sessionKey) ?? false;
        prevSendingByKey.set(sessionKey, sending);
        if (!wasSending || sending) continue;
        if (suppressedSessions.delete(sessionKey)) continue;
        if (sessionRunError(sessionKey)) continue;
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
