import { useChatStore } from '@/stores/chat';

/** True when the main (home) chat store has an in-flight or persisted conversation to show. */
export function useHomeConversationActive(): boolean {
  const messageCount = useChatStore((s) => s.messages.length);
  const sending = useChatStore((s) => s.sending);
  const pendingFinal = useChatStore((s) => s.pendingFinal);
  const streamingMessage = useChatStore((s) => s.streamingMessage);
  const streamingText = useChatStore((s) => s.streamingText);
  const streamingTools = useChatStore((s) => s.streamingTools);

  return (
    messageCount > 0
    || sending
    || pendingFinal
    || streamingMessage != null
    || Boolean(streamingText)
    || streamingTools.length > 0
  );
}
