import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import { subscribeHostEvent } from '@/lib/host-events';
import type { CanonicalChatEvent, ChatRuntimeSnapshot } from '../../../shared/chat-runtime-protocol';
import type { RawMessage } from './types';
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
  setDisplayProjection: (sessionKey: string, messages: RawMessage[] | null) => void;
  setOptimisticUserMessage: (sessionKey: string, message: RawMessage | null) => void;
  clearError: (sessionKey: string) => void;
  clearOverlay: (sessionKey: string) => void;
  clearSession: (sessionKey: string) => void;
}

let unsubscribe: (() => void) | null = null;
let initializePromise: Promise<void> | null = null;
const projectionListeners = new Set<(event: CanonicalChatEvent) => void>();
const hydratePromises = new Map<string, Promise<void>>();
let bootstrapping = false;
let bootstrapEvents: CanonicalChatEvent[] = [];
const MAX_PENDING_EVENTS = 200;

function notifyProjection(event: CanonicalChatEvent): void {
  for (const listener of projectionListeners) listener(event);
}

export function subscribeCanonicalChatRuntimeProjection(
  listener: (event: CanonicalChatEvent) => void,
): () => void {
  projectionListeners.add(listener);
  return () => projectionListeners.delete(listener);
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
    currentUserIndex = findLastMessageIndex(transcript, (message) => (
      message.role === 'user'
      && messageTimestampMs(message) >= (current.runtime?.startedAt ?? Number.MAX_SAFE_INTEGER)
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
  setTranscript: (sessionKey, transcript) => set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    const echoedId = current.overlay.optimisticUserMessage?.id;
    const optimisticEchoed = Boolean(echoedId && transcript.some((message) => message.id === echoedId));
    const transcriptSettled = current.runtime?.phase === 'completed'
      && transcriptContainsCompletedTurn(transcript, current);
    const nextOptimistic = optimisticEchoed || transcriptSettled
      ? null
      : current.overlay.optimisticUserMessage;
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
          transcript: [...transcript],
          overlay: {
            ...current.overlay,
            optimisticUserMessage: nextOptimistic,
            streamingMessage: transcriptSettled ? null : current.overlay.streamingMessage,
            streamingMessages: transcriptSettled ? [] : current.overlay.streamingMessages,
            streamingToolResults: transcriptSettled ? [] : current.overlay.streamingToolResults,
            streamingTools: transcriptSettled ? [] : current.overlay.streamingTools,
            awaitingTranscript: transcriptSettled ? false : current.overlay.awaitingTranscript,
          },
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
  setOptimisticUserMessage: (sessionKey, message) => set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
    if (current.overlay.optimisticUserMessage === message) return state;
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          overlay: { ...current.overlay, optimisticUserMessage: message },
          updatedAt: Date.now(),
        },
      },
    };
  }),
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
  clearOverlay: (sessionKey) => set((state) => {
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
  clearSession: (sessionKey) => set((state) => {
    if (!state.sessionsByKey[sessionKey]) return state;
    const sessionsByKey = { ...state.sessionsByKey };
    delete sessionsByKey[sessionKey];
    hydratePromises.delete(sessionKey);
    return { sessionsByKey };
  }),
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
      const snapshot = await invokeIpc<ChatRuntimeSnapshot | null>('chat-runtime:get', sessionKey);
      const latest = get().sessionsByKey[sessionKey];
      if (!latest || latest.sync.hydrationGeneration !== generation) return;
      let hydrated = snapshot ? applyRuntimeSnapshot(latest, snapshot) : latest;
      const pending = [...hydrated.sync.pendingEvents].sort((a, b) => (
        a.epoch === b.epoch ? a.sequence - b.sequence : a.epoch - b.epoch
      ));
      hydrated = { ...hydrated, sync: { ...hydrated.sync, status: 'ready', pendingEvents: [] } };
      set((state) => ({ sessionsByKey: { ...state.sessionsByKey, [sessionKey]: hydrated } }));
      for (const event of pending) {
        const accepted = get().applyEvent(event);
        if (accepted) notifyProjection(event);
      }
    })().finally(() => {
      if (hydratePromises.get(sessionKey) === operation) hydratePromises.delete(sessionKey);
    });
    hydratePromises.set(sessionKey, operation);
    return operation;
  },
  applyEvent: (event) => {
    const current = get().sessionsByKey[event.sessionKey] ?? createClientSessionState();
    if (current.sync.status === 'gapped' || current.sync.status === 'hydrating') {
      const pendingEvents = [...current.sync.pendingEvents, event].slice(-MAX_PENDING_EVENTS);
      set((state) => ({
        sessionsByKey: {
          ...state.sessionsByKey,
          [event.sessionKey]: { ...current, sync: { ...current.sync, pendingEvents } },
        },
      }));
      return false;
    }
    const reduction = reduceSessionEvent(current, event);
    if (reduction.needsHydration) {
      set((state) => ({
        sessionsByKey: {
          ...state.sessionsByKey,
          [event.sessionKey]: {
            ...current,
            sync: { ...current.sync, status: 'gapped', pendingEvents: [event] },
          },
        },
      }));
      void get().hydrate(event.sessionKey);
      return false;
    }
    if (!reduction.accepted) return false;
    set((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [event.sessionKey]: {
          ...reduction.state,
          sync: { ...reduction.state.sync, status: 'ready' },
        },
      },
    }));
    return true;
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
      const accepted = useChatRuntimeV2Store.getState().applyEvent(event);
      if (accepted) notifyProjection(event);
    }
    useChatRuntimeV2Store.setState({ initialized: true });
  })().finally(() => {
    if (bootstrapping) {
      bootstrapping = false;
      const buffered = bootstrapEvents;
      bootstrapEvents = [];
      for (const event of buffered) {
        const accepted = useChatRuntimeV2Store.getState().applyEvent(event);
        if (accepted) notifyProjection(event);
      }
    }
    initializePromise = null;
  });
  return initializePromise;
}
