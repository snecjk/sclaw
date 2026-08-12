import { useChatStore } from '@/stores/chat';
import { useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';

/** True when the main (home) chat store has an in-flight or persisted conversation to show. */
export function useHomeConversationActive(): boolean {
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messageCount = useCurrentChatDisplayMessages().length;
  const { sending, pendingFinal, streamingMessage, streamingTools } = useCurrentChatRuntimeView();
  const hasConversationContext = currentSessionKey !== DEFAULT_SESSION_KEY || messageCount > 0;

  return (
    hasConversationContext
    || sending
    || pendingFinal
    || streamingMessage != null
    || streamingTools.length > 0
  );
}
