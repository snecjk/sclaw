import { useChatStore } from '@/stores/chat';

export async function sendAppDevChatPrompt(sessionKey: string | null, text: string): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const chat = useChatStore.getState();
  if (sessionKey && chat.currentSessionKey !== sessionKey) {
    chat.switchSession(sessionKey);
  }
  const { dispatchChatSend } = await import('@/hooks/dispatch-chat-send');
  await dispatchChatSend({ text: trimmed });
  return true;
}
