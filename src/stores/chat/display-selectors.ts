import { useChatStore } from './store';
import { buildChatDisplayModel } from './display-model';
import { createClientSessionState } from './client-session-reducer';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import type { RawMessage } from './types';

const EMPTY_SESSION = createClientSessionState();
const displayModelCache = new WeakMap<object, RawMessage[]>();

function getDisplayModel(session: ReturnType<typeof createClientSessionState>): RawMessage[] {
  const cached = displayModelCache.get(session);
  if (cached) return cached;
  const messages = buildChatDisplayModel(
    session.transcript,
    session.overlay,
    session.decorations,
    { includeStreaming: false },
  );
  displayModelCache.set(session, messages);
  return messages;
}

export function getSessionDisplayMessages(sessionKey: string): RawMessage[] {
  const session = useChatRuntimeV2Store.getState().sessionsByKey[sessionKey]
    ?? EMPTY_SESSION;
  return getDisplayModel(session);
}

export function getCurrentChatDisplayMessages(): RawMessage[] {
  return getSessionDisplayMessages(useChatStore.getState().currentSessionKey);
}

export function updateSessionDisplayProjection(
  sessionKey: string,
  updater: (messages: RawMessage[]) => RawMessage[],
): void {
  const current = getSessionDisplayMessages(sessionKey);
  useChatRuntimeV2Store.getState().setDisplayProjection(sessionKey, updater(current));
}

export function updateCurrentChatDisplayProjection(
  updater: (messages: RawMessage[]) => RawMessage[],
): void {
  const sessionKey = useChatStore.getState().currentSessionKey;
  updateSessionDisplayProjection(sessionKey, updater);
}

export function useCurrentChatDisplayMessages(): RawMessage[] {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  const session = useChatRuntimeV2Store((state) => state.sessionsByKey[sessionKey]);
  return getDisplayModel(session ?? EMPTY_SESSION);
}

export function useCurrentChatDisplayMessageCount(): number {
  const sessionKey = useChatStore((state) => state.currentSessionKey);
  return useChatRuntimeV2Store((state) => (
    getDisplayModel(state.sessionsByKey[sessionKey] ?? EMPTY_SESSION).length
  ));
}
