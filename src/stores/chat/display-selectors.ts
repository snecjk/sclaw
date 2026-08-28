import { useChatStore } from './store';
import { buildChatDisplayModel } from './display-model';
import { createClientSessionState } from './client-session-reducer';
import { useChatRuntimeV2Store } from './runtime-v2-store';
import type { RawMessage } from './types';

const EMPTY_SESSION = createClientSessionState();

/**
 * 缓存键必须是真正决定输出的输入，而不是 session 本身。session 在每个
 * message.delta 上都会新建，但 includeStreaming:false 的输出只取决于源数组
 * 与乐观消息 —— 流式内容不进这个模型。用 session 做键会在流式期间每次 miss，
 * 返回一个内容相同但引用全新的数组，使整条消息列表的 memo 与 useMemo 集体失效。
 */
const displayModelCache = new WeakMap<object, {
  optimistic: RawMessage | null;
  messages: RawMessage[];
}>();

function getDisplayModel(session: ReturnType<typeof createClientSessionState>): RawMessage[] {
  const source = session.decorations?.projectedMessages ?? session.transcript;
  const optimistic = session.overlay.optimisticUserMessage ?? null;
  const cached = displayModelCache.get(source);
  if (cached && cached.optimistic === optimistic) return cached.messages;
  const messages = buildChatDisplayModel(
    session.transcript,
    session.overlay,
    session.decorations,
    { includeStreaming: false },
  );
  displayModelCache.set(source, { optimistic, messages });
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
