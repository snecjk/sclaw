import { useChatStore } from '@/stores/chat';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

/** True when the main (home) chat store has an in-flight or persisted conversation to show. */
export function useHomeConversationActive(): boolean {
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messageCount = useChatStore((s) => s.messages.length);
  const loading = useChatStore((s) => s.loading);
  const sending = useChatStore((s) => s.sending);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingTools = useChatStore((s) => s.streamingTools);

  return (
    currentSessionKey !== DEFAULT_SESSION_KEY
    || messageCount > 0
    || loading
    || sending
    || pendingFinal
    || streamingMessage != null
    || Boolean(streamingText)
    || streamingTools.length > 0
  );
}
