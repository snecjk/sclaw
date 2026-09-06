import type { ChatContextUsage } from '../../../../shared/chat-runtime-protocol';

export function selectLatestContextUsage(
  runtimeUsage: ChatContextUsage | null | undefined,
  fetchedUsage: ChatContextUsage | null | undefined,
): ChatContextUsage | null {
  if (!runtimeUsage) return fetchedUsage ?? null;
  if (!fetchedUsage) return runtimeUsage;
  return runtimeUsage.updatedAt >= fetchedUsage.updatedAt ? runtimeUsage : fetchedUsage;
}
