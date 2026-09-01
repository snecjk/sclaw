import { VISIBLE_TURN_TOOL_LIMIT } from '../../../../shared/chat-tool-payload';
import type { ThinkingTimelineItem } from '../message-utils';

export interface FoldedTurnTools<T> {
  visible: T[];
  hiddenToolCount: number;
  totalToolCount: number;
}

export function foldToolList<T>(
  tools: readonly T[],
  limit = VISIBLE_TURN_TOOL_LIMIT,
): FoldedTurnTools<T> {
  const totalToolCount = tools.length;
  if (totalToolCount <= limit) {
    return { visible: [...tools], hiddenToolCount: 0, totalToolCount };
  }
  return {
    visible: tools.slice(-limit) as T[],
    hiddenToolCount: totalToolCount - limit,
    totalToolCount,
  };
}

/** Keep non-tool timeline rows; only cap how many tool cards stay in the DOM. */
export function foldThinkingTimelineTools(
  timeline: readonly ThinkingTimelineItem[],
  limit = VISIBLE_TURN_TOOL_LIMIT,
): FoldedTurnTools<ThinkingTimelineItem> {
  const toolIndexes: number[] = [];
  timeline.forEach((item, index) => {
    if (item.type === 'tool') toolIndexes.push(index);
  });
  const totalToolCount = toolIndexes.length;
  if (totalToolCount <= limit) {
    return { visible: [...timeline], hiddenToolCount: 0, totalToolCount };
  }
  const keep = new Set(toolIndexes.slice(-limit));
  return {
    visible: timeline.filter((item, index) => item.type !== 'tool' || keep.has(index)),
    hiddenToolCount: totalToolCount - limit,
    totalToolCount,
  };
}

/** Overlay window may be capped; monotonic run count is the label source of truth. */
export function resolveTurnToolCount(
  runToolEventCount: number | undefined,
  windowToolCount: number,
): number {
  return Math.max(runToolEventCount ?? 0, windowToolCount);
}
