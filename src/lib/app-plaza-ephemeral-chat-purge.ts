/**
 * Purge ephemeral embed-browser chat collections (index + best-effort session delete).
 */
import { peekEmbedChatIndex, clearEmbedChatIndex } from '@/lib/sclaw-browser-chat-index';
import { useChatStore } from '@/stores/chat';

/** Remove local index and best-effort delete each session. No confirm dialog. */
export async function purgeEphemeralEmbedChatForApp(appId: string): Promise<void> {
  const trimmed = appId?.trim();
  if (!trimmed) return;

  const index = peekEmbedChatIndex(trimmed);
  const keys = index.items.map((item) => item.key);
  clearEmbedChatIndex(trimmed);

  const deleteSession = useChatStore.getState().deleteSession;
  await Promise.all(
    keys.map((key) =>
      deleteSession(key, { skipSessionRefresh: true }).catch(() => {
        // Best-effort purge — index already cleared.
      }),
    ),
  );
}
