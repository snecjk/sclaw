import type { ChatContextUsage } from '../../../../shared/chat-runtime-protocol';

export const MANUAL_CONTEXT_COMPACTION_MIN_PERCENT = 30;

export function meetsManualContextCompactionThreshold(
  percent: number | null | undefined,
): boolean {
  return percent != null
    && Math.round(percent) >= MANUAL_CONTEXT_COMPACTION_MIN_PERCENT;
}

export function selectLatestContextUsage(
  runtimeUsage: ChatContextUsage | null | undefined,
  fetchedUsage: ChatContextUsage | null | undefined,
): ChatContextUsage | null {
  if (!runtimeUsage) return fetchedUsage ?? null;
  if (!fetchedUsage) return runtimeUsage;
  return runtimeUsage.updatedAt >= fetchedUsage.updatedAt ? runtimeUsage : fetchedUsage;
}
