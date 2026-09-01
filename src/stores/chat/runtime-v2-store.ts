import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import { AppError } from '@/lib/error-model';
import { isTerminalChatRunPhase } from '../../../shared/chat-runtime-protocol';
import type { CanonicalChatEvent, ChatRuntimeSnapshot } from '../../../shared/chat-runtime-protocol';
import { trimHistoryTail } from '../../../shared/chat-history-page';
import { CHAT_HISTORY_LIMIT } from '../../../shared/chat-config';
import type { ChatHistoryFingerprint } from '../../../shared/chat-history-fingerprint';
import type { RawMessage } from './types';
import { findHistoryUserEcho } from './user-message-merge';
import { materializeCompletedOverlay } from './display-model';
import {
  applyRuntimeSnapshot,
  createClientSessionState,
  reduceSessionEvent,
  type ClientSessionState,
} from './client-session-reducer';

interface ChatRuntimeV2State {
  sessionsByKey: Record<string, ClientSessionState>;
  initialized: boolean;
  hydrate: (sessionKey: string) => Promise<void>;
  applyEvent: (event: CanonicalChatEvent) => boolean;
  setTranscript: (sessionKey: string, transcript: RawMessage[]) => void;
  setHistoryFingerprint: (sessionKey: string, fingerprint: ChatHistoryFingerprint | null) => void;
  setHistoryTotalCount: (sessionKey: string, totalCount: number) => void;
  trimSessionHistoryTail: (sessionKey: string, limit?: number) => void;
  setDisplayProjection: (sessionKey: string, messages: RawMessage[] | null) => void;
  setOptimisticUserMessage: (sessionKey: string, message: RawMessage | null) => void;
  clearError: (sessionKey: string) => void;
  setError: (sessionKey: string, error: AppError) => void;
  clearOverlay: (sessionKey: string) => void;
  clearSession: (sessionKey: string) => void;
}

let unsubscribe: (() => void) | null = null;
let initializePromise: Promise<void> | null = null;
const projectionListeners = new Set<(event: CanonicalChatEvent) => void>();
const hydratePromises = new Map<string, Promise<void>>();
const hydrateRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let bootstrapping = false;
let bootstrapEvents: CanonicalChatEvent[] = [];
const MAX_PENDING_EVENTS = 200;
const HYDRATE_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;

function clearHydrateRetry(sessionKey: string): void {
  const timer = hydrateRetryTimers.get(sessionKey);
  if (timer) clearTimeout(timer);
  hydrateRetryTimers.delete(sessionKey);
}

function scheduleHydrateRetry(sessionKey: string, retryCount: number): void {
  if (hydrateRetryTimers.has(sessionKey)) return;
  const delay = HYDRATE_RETRY_DELAYS_MS[Math.min(retryCount, HYDRATE_RETRY_DELAYS_MS.length - 1)];
  const retryAt = Date.now() + delay;
  useChatRuntimeV2Store.setState((state) => {
    const current = state.sessionsByKey[sessionKey];
    if (!current) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          sync: { ...current.sync, status: 'gapped', retryAt },
        },
      },
    };
  });
  hydrateRetryTimers.set(sessionKey, setTimeout(() => {
    hydrateRetryTimers.delete(sessionKey);
    if (!useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]) return;
    void useChatRuntimeV2Store.getState().hydrate(sessionKey);
  }, delay));
}

function notifyProjection(event: CanonicalChatEvent): void {
  for (const listener of projectionListeners) listener(event);
}

export function subscribeCanonicalChatRuntimeProjection(
  listener: (event: CanonicalChatEvent) => void,
): () => void {
  projectionListeners.add(listener);
  return () => projectionListeners.delete(listener);
}

interface SessionEventApplyResult {
  next: ClientSessionState;
  accepted: boolean;
  needsHydration: boolean;
}

/** applyEvent 的单会话归约（不提交 store）；合帧 flush 与单事件路径共用，保证语义一致 */
function reduceEventIntoSession(
  current: ClientSessionState,
  event: CanonicalChatEvent,
): SessionEventApplyResult {
  if (current.sync.status === 'gapped' || current.sync.status === 'hydrating') {
    const allPendingEvents = [...current.sync.pendingEvents, event];
    const bufferOverflowed = current.sync.bufferOverflowed || allPendingEvents.length > MAX_PENDING_EVENTS;
    const pendingEvents = allPendingEvents.slice(-MAX_PENDING_EVENTS);
    return {
      next: { ...current, sync: { ...current.sync, pendingEvents, bufferOverflowed } },
      accepted: false,
      needsHydration: false,
    };
  }
  const reduction = reduceSessionEvent(current, event);
  if (reduction.needsHydration) {
    return {
      next: {
        ...current,
        sync: {
          ...current.sync,
          status: 'gapped',
          pendingEvents: [event],
          retryAt: null,
        },
      },
      accepted: false,
      needsHydration: true,
    };
  }
  if (!reduction.accepted) return { next: current, accepted: false, needsHydration: false };
  return {
    next: {
      ...reduction.state,
      sync: { ...reduction.state.sync, status: 'ready' },
    },
    accepted: true,
    needsHydration: false,
  };
}

/**
 * 同步应用单个事件（不经过 delta 合帧队列）。
 * 用于 hydrate/bootstrap 回放等不能延迟、也不能丢失 projection 通知的场景。
 */
function applyEventToStoreImmediately(event: CanonicalChatEvent): void {
  const current = useChatRuntimeV2Store.getState().sessionsByKey[event.sessionKey]
    ?? createClientSessionState();
  const result = reduceEventIntoSession(current, event);
  if (result.next !== current) {
    useChatRuntimeV2Store.setState((state) => ({
      sessionsByKey: { ...state.sessionsByKey, [event.sessionKey]: result.next },
    }));
  }
  if (result.accepted) notifyProjection(event);
  if (result.needsHydration) void useChatRuntimeV2Store.getState().hydrate(event.sessionKey);
}

/**
 * message.delta 合帧（chat-thinking-perf 3.1）：delta 先入队，每帧（rAF；无 rAF 环境
 * 退化为 40ms 时间片）最多一次 store 提交。任何非 delta 事件 / transcript 写入到来前
 * 先同步 flush，保证事件不丢、与同会话后续事件顺序不乱。
 */
const pendingDeltaEvents: CanonicalChatEvent[] = [];
let deltaFlushScheduled = false;

function scheduleChatDeltaFlush(): void {
  if (deltaFlushScheduled) return;
  deltaFlushScheduled = true;
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => flushPendingChatRuntimeDeltas());
    return;
  }
  setTimeout(() => flushPendingChatRuntimeDeltas(), 40);
}

function enqueueChatDeltaEvent(event: CanonicalChatEvent): void {
  pendingDeltaEvents.push(event);
  scheduleChatDeltaFlush();
}

/** 把已排队的 delta 按序归约并一次性提交；导出供测试与非 delta 路径强制对齐 */
export function flushPendingChatRuntimeDeltas(): void {
  deltaFlushScheduled = false;
  if (pendingDeltaEvents.length === 0) return;
  const events = pendingDeltaEvents.splice(0, pendingDeltaEvents.length);
  const baseState = useChatRuntimeV2Store.getState();
  const nextByKey = new Map<string, ClientSessionState>();
  const acceptedEvents: CanonicalChatEvent[] = [];
  const hydrateKeys: string[] = [];

  for (const event of events) {
    const current =
      nextByKey.get(event.sessionKey)
      ?? baseState.sessionsByKey[event.sessionKey]
      ?? createClientSessionState();
    const result = reduceEventIntoSession(current, event);
    if (result.next !== current) nextByKey.set(event.sessionKey, result.next);
    if (result.accepted) acceptedEvents.push(event);
    if (result.needsHydration) hydrateKeys.push(event.sessionKey);
  }

  if (nextByKey.size > 0) {
    useChatRuntimeV2Store.setState((state) => {
      const sessionsByKey = { ...state.sessionsByKey };
      for (const [sessionKey, next] of nextByKey) {
        sessionsByKey[sessionKey] = next;
      }
      return { sessionsByKey };
    });
  }
  for (const event of acceptedEvents) notifyProjection(event);
  for (const sessionKey of hydrateKeys) {
    void useChatRuntimeV2Store.getState().hydrate(sessionKey);
  }

  // flush 期间（projection 监听器等同步路径）新到的 delta 排下一帧
  if (pendingDeltaEvents.length > 0) scheduleChatDeltaFlush();
}

function dropPendingChatRuntimeDeltas(sessionKey: string): void {
  for (let index = pendingDeltaEvents.length - 1; index >= 0; index -= 1) {
    if (pendingDeltaEvents[index]?.sessionKey === sessionKey) {
      pendingDeltaEvents.splice(index, 1);
    }
  }
}

function messageTimestampMs(message: RawMessage): number {
  const value = message.timestamp;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function comparableContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  try {
    return JSON.stringify(content) ?? '';
  } catch {
    return '';
  }
}

function messagesEqual(left: RawMessage[] | null, right: RawMessage[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    try {
      if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function findLastMessageIndex(
  messages: RawMessage[],
  predicate: (message: RawMessage) => boolean,
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return index;
  }
  return -1;
}

function transcriptContainsCompletedTurn(
  transcript: RawMessage[],
  current: ClientSessionState,
): boolean {
  const optimistic = current.overlay.optimisticUserMessage;
  let currentUserIndex = optimistic?.id
    ? transcript.findIndex((message) => message.role === 'user' && message.id === optimistic.id)
    : -1;
  if (currentUserIndex < 0 && optimistic) {
    const expected = comparableContent(optimistic.content);
    currentUserIndex = findLastMessageIndex(transcript,
      (message) => message.role === 'user' && comparableContent(message.content) === expected,
    );
  }
  if (currentUserIndex < 0) {
    // 兜底：按 startedAt 之后的首条 user 消息判定。定时任务无乐观消息，走此路径。
    // 容差 2s（仅在无乐观消息时生效，即定时任务场景）：echo user 的 timestamp 可能
    // 因数据库写入顺序/时钟偏移略早于 startedAt，严格 `>=` 会漏过导致误判「未完成」
    // （见 §5.7 时钟边界）。有乐观消息的 chat 链路保持严格 `>=`，避免把上一轮 user
    // 误当作当前 run 的回显而提前清掉 streaming overlay。
    const startedAt = current.runtime?.startedAt ?? Number.MAX_SAFE_INTEGER;
    const lowerBound = !optimistic && startedAt !== Number.MAX_SAFE_INTEGER
      ? startedAt - 2_000
      : startedAt;
    currentUserIndex = findLastMessageIndex(transcript, (message) => (
      message.role === 'user'
      && messageTimestampMs(message) >= lowerBound
    ));
  }
  if (currentUserIndex < 0) return false;
  return transcript.slice(currentUserIndex + 1).some((message) => (
    message.role === 'assistant' && comparableContent(message.content).length > 0
  ));
}

export const useChatRuntimeV2Store = create<ChatRuntimeV2State>((set, get) => ({
  sessionsByKey: {},
  initialized: false,
  setTranscript: (sessionKey, transcript) => {
    // 先对齐已排队 delta，避免用未含 delta 的 overlay 计算 transcriptSettled
    flushPendingChatRuntimeDeltas();
    set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    const optimistic = current.overlay.optimisticUserMessage;
    const echoedId = optimistic?.id;
    const optimisticEchoedById = Boolean(echoedId && transcript.some((message) => message.id === echoedId));
    const optimisticRefAt = optimistic
      ? (current.runtime?.startedAt
        ?? (typeof optimistic.timestamp === 'number' ? messageTimestampMs(optimistic) : 0))
      : 0;
    const optimisticEchoedByPairing = Boolean(
      optimistic
      && !optimisticEchoedById
      && findHistoryUserEcho(transcript, optimistic, optimisticRefAt),
    );
    const transcriptSettled = current.runtime?.phase === 'completed'
      && transcriptContainsCompletedTurn(transcript, current);
    const nextOptimistic = optimisticEchoedById || optimisticEchoedByPairing || transcriptSettled
      ? null
      : optimistic;
    const transcriptUnchanged = messagesEqual(current.transcript, transcript);
    const overlayUnchanged = nextOptimistic === current.overlay.optimisticUserMessage
      && (!transcriptSettled || (
        current.overlay.streamingMessage === null
        && current.overlay.streamingMessages.length === 0
        && current.overlay.streamingToolResults.length === 0
        && current.overlay.streamingTools.length === 0
        && !current.overlay.awaitingTranscript
      ));
    if (transcriptUnchanged && overlayUnchanged) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          // 内容等价时保留原引用：下游展示模型以该数组为缓存键，
          // 无谓的新引用会让整条消息列表的 memo 失效。
          transcript: transcriptUnchanged ? current.transcript : [...transcript],
          overlay: {
            ...current.overlay,
            optimisticUserMessage: nextOptimistic,
            streamingMessage: transcriptSettled ? null : current.overlay.streamingMessage,
            streamingMessages: transcriptSettled ? [] : current.overlay.streamingMessages,
            streamingToolResults: transcriptSettled ? [] : current.overlay.streamingToolResults,
            streamingTools: transcriptSettled ? [] : current.overlay.streamingTools,
            toolEventCount: transcriptSettled ? 0 : current.overlay.toolEventCount ?? 0,
            awaitingTranscript: transcriptSettled ? false : current.overlay.awaitingTranscript,
          },
          updatedAt: Date.now(),
        },
      },
    };
    });
  },
  setHistoryFingerprint: (sessionKey, fingerprint) => set((state) => {
    const current = state.sessionsByKey[sessionKey];
    if (!current || current.historyFingerprint === fingerprint) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          historyFingerprint: fingerprint,
        },
      },
    };
  }),
  setHistoryTotalCount: (sessionKey, totalCount) => set((state) => {
    const current = state.sessionsByKey[sessionKey];
    const nextCount = Number.isFinite(totalCount) && totalCount > 0 ? Math.floor(totalCount) : 0;
    if (!current || current.historyTotalCount === nextCount) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          historyTotalCount: nextCount,
        },
      },
    };
  }),
  trimSessionHistoryTail: (sessionKey, limit = CHAT_HISTORY_LIMIT) => set((state) => {
    const current = state.sessionsByKey[sessionKey];
    if (!current) return state;
    if (current.runtime && !isTerminalChatRunPhase(current.runtime.phase)) return state;
    if (current.transcript.length <= limit) return state;
    const trimmed = trimHistoryTail(current.transcript, limit);
    const totalCount = Math.max(current.historyTotalCount, current.transcript.length);
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          transcript: trimmed,
          historyTotalCount: totalCount,
          decorations: { ...current.decorations, projectedMessages: null },
          updatedAt: Date.now(),
        },
      },
    };
  }),
  setDisplayProjection: (sessionKey, messages) => set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    if (messagesEqual(current.decorations.projectedMessages, messages)) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          decorations: {
            ...current.decorations,
            projectedMessages: messages ? [...messages] : null,
          },
          updatedAt: Date.now(),
        },
      },
    };
  }),
  setOptimisticUserMessage: (sessionKey, message) => {
    // 与 setTranscript 同理：先对齐已排队 delta，再基于最新 overlay 判断物化
    flushPendingChatRuntimeDeltas();
    set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    if (current.overlay.optimisticUserMessage === message) return state;
    const shouldMaterializeCompletedOverlay = Boolean(
      message
      && current.runtime?.phase === 'completed'
      && current.overlay.awaitingTranscript
      && (
        current.overlay.streamingMessage
        || current.overlay.streamingMessages.length > 0
        || current.overlay.streamingToolResults.length > 0
      )
    );
    const projectedMessages = shouldMaterializeCompletedOverlay
      ? materializeCompletedOverlay(current.transcript, current.overlay, current.decorations)
      : current.decorations.projectedMessages;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          decorations: shouldMaterializeCompletedOverlay
            ? { ...current.decorations, projectedMessages }
            : current.decorations,
          overlay: {
            ...current.overlay,
            optimisticUserMessage: message,
            streamingMessage: shouldMaterializeCompletedOverlay
              ? null
              : current.overlay.streamingMessage,
            streamingMessages: shouldMaterializeCompletedOverlay
              ? []
              : current.overlay.streamingMessages,
            streamingToolResults: shouldMaterializeCompletedOverlay
              ? []
              : current.overlay.streamingToolResults,
            streamingTools: shouldMaterializeCompletedOverlay
              ? []
              : current.overlay.streamingTools,
            toolEventCount: shouldMaterializeCompletedOverlay
              ? 0
              : current.overlay.toolEventCount ?? 0,
            awaitingTranscript: shouldMaterializeCompletedOverlay
              ? false
              : current.overlay.awaitingTranscript,
          },
          updatedAt: Date.now(),
        },
      },
    };
    });
  },
  clearError: (sessionKey) => set((state) => {
    const current = state.sessionsByKey[sessionKey];
    if (!current?.error) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: { ...current, error: null, updatedAt: Date.now() },
      },
    };
  }),
  setError: (sessionKey, error) => set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    if (current.error?.message === error.message && current.error.code === error.code) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: { ...current, error, updatedAt: Date.now() },
      },
    };
  }),
  clearOverlay: (sessionKey) => set((state) => {
    // 清 overlay 同时丢弃本会话未提交的排队 delta，否则 rAF flush 可能把流式又写回来
    dropPendingChatRuntimeDeltas(sessionKey);
    const current = state.sessionsByKey[sessionKey];
    if (!current) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          overlay: createClientSessionState().overlay,
          updatedAt: Date.now(),
        },
      },
    };
  }),
  clearSession: (sessionKey) => {
    // 会话销毁时丢弃其未提交的 delta，避免重建出僵尸会话状态
    dropPendingChatRuntimeDeltas(sessionKey);
    set((state) => {
    if (!state.sessionsByKey[sessionKey]) return state;
    const sessionsByKey = { ...state.sessionsByKey };
    delete sessionsByKey[sessionKey];
    hydratePromises.delete(sessionKey);
    clearHydrateRetry(sessionKey);
    return { sessionsByKey };
    });
  },
  hydrate: async (sessionKey) => {
    const existing = hydratePromises.get(sessionKey);
    if (existing) return existing;
    const current = get().sessionsByKey[sessionKey] ?? createClientSessionState();
    const generation = current.sync.hydrationGeneration + 1;
    set((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...(state.sessionsByKey[sessionKey] ?? createClientSessionState()),
          sync: {
            ...(state.sessionsByKey[sessionKey]?.sync ?? current.sync),
            status: current.sync.status === 'gapped' ? 'gapped' : 'hydrating',
            hydrationGeneration: generation,
          },
        },
      },
    }));
    const operation = (async () => {
      try {
        const snapshot = await invokeIpc<ChatRuntimeSnapshot | null>('chat-runtime:get', sessionKey);
        const latest = get().sessionsByKey[sessionKey];
        if (!latest || latest.sync.hydrationGeneration !== generation) return;
        let hydrated = snapshot ? applyRuntimeSnapshot(latest, snapshot) : latest;
        const pending = [...hydrated.sync.pendingEvents].sort((a, b) => (
          a.epoch === b.epoch ? a.sequence - b.sequence : a.epoch - b.epoch
        ));
        const bufferOverflowed = hydrated.sync.bufferOverflowed;
        hydrated = {
          ...hydrated,
          sync: {
            ...hydrated.sync,
            status: 'ready',
            pendingEvents: [],
            retryCount: 0,
            retryAt: null,
            bufferOverflowed: false,
          },
        };
        clearHydrateRetry(sessionKey);
        set((state) => ({ sessionsByKey: { ...state.sessionsByKey, [sessionKey]: hydrated } }));
        for (const event of pending) {
          // hydrate 回放不能进 delta 合帧队列，否则 delta  return false 会导致
          // 回放期间 UI 缺一段流式，projection 通知也要等到 rAF flush 才发出。
          applyEventToStoreImmediately(event);
        }
        if (bufferOverflowed) {
          void import('./store').then(({ useChatStore }) => (
            useChatStore.getState().loadHistory(true, true, sessionKey)
          ));
        }
      } catch (error) {
        const latest = get().sessionsByKey[sessionKey];
        if (!latest || latest.sync.hydrationGeneration !== generation) return;
        const retryCount = latest.sync.retryCount + 1;
        set((state) => ({
          sessionsByKey: {
            ...state.sessionsByKey,
            [sessionKey]: {
              ...latest,
              error: latest.error,
              sync: {
                ...latest.sync,
                status: 'gapped',
                retryCount,
                retryAt: null,
              },
            },
          },
        }));
        console.warn('[chat-runtime] session hydrate failed; retry scheduled', {
          sessionKey,
          retryCount,
          error: error instanceof Error ? error.message : String(error),
        });
        scheduleHydrateRetry(sessionKey, retryCount - 1);
      }
    })().finally(() => {
      if (hydratePromises.get(sessionKey) === operation) hydratePromises.delete(sessionKey);
    });
    hydratePromises.set(sessionKey, operation);
    return operation;
  },
  applyEvent: (event) => {
    // delta 走合帧队列：本帧统一提交，projection 通知也在 flush 时按序发出。
    // 因此 applyEvent(delta) 返回 false，调用方不要把它理解成「事件被拒绝」；
    // 同步回放路径（hydrate/bootstrap）应使用 applyEventToStoreImmediately。
    if (event.type === 'message.delta') {
      enqueueChatDeltaEvent(event);
      return false;
    }
    // 非 delta 事件（final / run 终态等）必须先 flush 已排队 delta，再按原语义处理
    flushPendingChatRuntimeDeltas();
    const current = get().sessionsByKey[event.sessionKey] ?? createClientSessionState();
    const result = reduceEventIntoSession(current, event);
    if (result.next !== current) {
      set((state) => ({
        sessionsByKey: {
          ...state.sessionsByKey,
          [event.sessionKey]: result.next,
        },
      }));
    }
    if (result.needsHydration) {
      void get().hydrate(event.sessionKey);
    }
    return result.accepted;
  },
}));

export async function initializeChatRuntimeV2(): Promise<void> {
  if (useChatRuntimeV2Store.getState().initialized) return;
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    bootstrapping = true;
    if (!unsubscribe) {
      unsubscribe = subscribeHostEvent<CanonicalChatEvent>('chat-runtime:event', (event) => {
        if (bootstrapping) {
          bootstrapEvents.push(event);
          return;
        }
        const accepted = useChatRuntimeV2Store.getState().applyEvent(event);
        if (accepted) notifyProjection(event);
      });
    }
    const response = await invokeIpc<ChatRuntimeSnapshot[]>('chat-runtime:listActive');
    const active = Array.isArray(response) ? response : [];
    for (const snapshot of active) {
      useChatRuntimeV2Store.setState((state) => ({
        sessionsByKey: {
          ...state.sessionsByKey,
          [snapshot.sessionKey]: applyRuntimeSnapshot(
            state.sessionsByKey[snapshot.sessionKey] ?? createClientSessionState(),
            snapshot,
          ),
        },
      }));
    }
    bootstrapping = false;
    const buffered = bootstrapEvents;
    bootstrapEvents = [];
    for (const event of buffered) {
      // 初始化缓存事件同样同步回放，避免 delta 被合帧队列吞掉 projection 通知
      applyEventToStoreImmediately(event);
    }
    useChatRuntimeV2Store.setState({ initialized: true });
  })().finally(() => {
    if (bootstrapping) {
      bootstrapping = false;
      const buffered = bootstrapEvents;
      bootstrapEvents = [];
      for (const event of buffered) {
        // 兜底路径与主初始化路径一致：同步回放，避免 delta 被合帧队列吞掉通知
        applyEventToStoreImmediately(event);
      }
    }
    initializePromise = null;
  });
  return initializePromise;
}
