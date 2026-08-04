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
  setOptimisticUserMessage: (sessionKey: string, message: RawMessage | null) => void;
  clearError: (sessionKey: string) => void;
  clearOverlay: (sessionKey: string) => void;
}

let unsubscribe: (() => void) | null = null;
let initializePromise: Promise<void> | null = null;
const projectionListeners = new Set<(event: CanonicalChatEvent) => void>();

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
    return {
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: {
          ...current,
          transcript: [...transcript],
          overlay: {
            ...current.overlay,
            optimisticUserMessage: optimisticEchoed || transcriptSettled
              ? null
              : current.overlay.optimisticUserMessage,
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
  setOptimisticUserMessage: (sessionKey, message) => set((state) => {
    const current = state.sessionsByKey[sessionKey] ?? createClientSessionState();
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
  hydrate: async (sessionKey) => {
    const snapshot = await invokeIpc<ChatRuntimeSnapshot | null>('chat-runtime:get', sessionKey);
    if (!snapshot) return;
    set((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [sessionKey]: applyRuntimeSnapshot(
          state.sessionsByKey[sessionKey] ?? createClientSessionState(),
          snapshot,
        ),
      },
    }));
  },
  applyEvent: (event) => {
    const current = get().sessionsByKey[event.sessionKey] ?? createClientSessionState();
    const reduction = reduceSessionEvent(current, event);
    if (reduction.needsHydration) {
      void get().hydrate(event.sessionKey);
      return false;
    }
    if (!reduction.accepted) return false;
    set((state) => ({
      sessionsByKey: {
        ...state.sessionsByKey,
        [event.sessionKey]: reduction.state,
      },
    }));
    return true;
  },
}));

export async function initializeChatRuntimeV2(): Promise<void> {
  if (useChatRuntimeV2Store.getState().initialized) return;
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
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
    if (!unsubscribe) {
      unsubscribe = subscribeHostEvent<CanonicalChatEvent>('chat-runtime:event', (event) => {
        const accepted = useChatRuntimeV2Store.getState().applyEvent(event);
        if (!accepted) return;
        for (const listener of projectionListeners) listener(event);
      });
    }
    useChatRuntimeV2Store.setState({ initialized: true });
  })().finally(() => {
    initializePromise = null;
  });
  return initializePromise;
}
