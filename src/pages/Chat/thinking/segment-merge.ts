import { mergeTimelineMonotonic } from '@/lib/thinking-timeline-active';
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import { isChronologicallyOrderedLayout } from '@/pages/Chat/thinking/done-segment-normalize';
import type {
  ThinkingTurnSegment,
  ThinkingToolGroupSegment,
} from '@/pages/Chat/thinking/types';
import {
  mergeAdjacentOrphanedThinkingAndToolGroups,
  pruneDuplicateToolOnlyGroups,
  relocateInterruptPhaseBetweenAdjacentToolGroups,
} from '@/pages/Chat/thinking/adjacent-group-phase';

const globalStableSegmentsByTurn = new Map<string, ThinkingTurnSegment[]>();
const globalStableTimelineByTurn = new Map<string, ThinkingTimelineItem[]>();

/**
 * Live rendering follows the latest parser projection, regardless of length.
 * A longer cached projection is only a fallback when the live projection is
 * momentarily empty during a turn-key hand-off.
 */
export function resolveLiveProjection<T>(
  incoming: T[],
  cached: T[],
  isLiveStream: boolean,
): T[] | null {
  if (!isLiveStream) return null;
  return incoming.length > 0 ? incoming : cached;
}

export function buildTurnDisplayCacheKey(
  sessionKey: string,
  turnStableKey: string | undefined,
): string | undefined {
  return turnStableKey ? `${sessionKey}::${turnStableKey}` : undefined;
}

export function readGlobalStableSegments(turnStableKey: string | undefined): ThinkingTurnSegment[] {
  if (!turnStableKey) return [];
  return globalStableSegmentsByTurn.get(turnStableKey) ?? [];
}

export function writeGlobalStableSegments(
  turnStableKey: string | undefined,
  segments: ThinkingTurnSegment[],
): void {
  if (!turnStableKey || segments.length === 0) return;
  globalStableSegmentsByTurn.set(turnStableKey, segments);
}

export function readGlobalStableTimeline(
  turnStableKey: string | undefined,
  segmentKey: string,
): ThinkingTimelineItem[] {
  if (!turnStableKey) return [];
  return globalStableTimelineByTurn.get(`${turnStableKey}::${segmentKey}`) ?? [];
}

export function writeGlobalStableTimeline(
  turnStableKey: string | undefined,
  segmentKey: string,
  timeline: ThinkingTimelineItem[],
): void {
  if (!turnStableKey || timeline.length === 0) return;
  globalStableTimelineByTurn.set(`${turnStableKey}::${segmentKey}`, timeline);
}

export function shouldPromoteActiveTurnCache(
  previousTurnStableKey: string | undefined,
  nextTurnStableKey: string | undefined,
): boolean {
  return previousTurnStableKey === 'active-turn'
    && Boolean(nextTurnStableKey)
    && nextTurnStableKey !== 'active-turn';
}

/** active-turn → turn-user-* 时一次性迁移 global 缓存，避免展开后 timeline 空白。 */
export function migrateTurnDisplayCache(fromKey: string | undefined, toKey: string | undefined): void {
  if (!fromKey || !toKey || fromKey === toKey) return;

  const cachedSegments = globalStableSegmentsByTurn.get(fromKey);
  if (cachedSegments && cachedSegments.length > 0) {
    const existing = globalStableSegmentsByTurn.get(toKey) ?? [];
    globalStableSegmentsByTurn.set(
      toKey,
      existing.length > 0 ? mergeSegmentsMonotonic(existing, cachedSegments) : cachedSegments,
    );
  }

  const fromPrefix = `${fromKey}::`;
  for (const [cacheKey, timeline] of globalStableTimelineByTurn.entries()) {
    if (!cacheKey.startsWith(fromPrefix) || timeline.length === 0) continue;
    const segmentKey = cacheKey.slice(fromPrefix.length);
    const destKey = `${toKey}::${segmentKey}`;
    const existing = globalStableTimelineByTurn.get(destKey) ?? [];
    const merged = mergeTimelineMonotonic(existing, timeline);
    if (merged.length > 0) {
      globalStableTimelineByTurn.set(destKey, merged);
    }
  }

  // `active-turn` is a transient hand-off key. Leaving it populated makes the
  // next conversation inherit the previous run's thinking/tool timeline.
  globalStableSegmentsByTurn.delete(fromKey);
  for (const cacheKey of [...globalStableTimelineByTurn.keys()]) {
    if (cacheKey.startsWith(fromPrefix)) {
      globalStableTimelineByTurn.delete(cacheKey);
    }
  }
}

/**
 * 单 segment 单调合并：同一 key 下 timeline 只增不减，已完成批次不回退为 active。
 * 解析器每 tick 全量重算时 OpenClaw 可能把多批压成一批并清空 timeline，展示层需 sticky。
 */
export function mergeTurnSegmentMonotonic(
  cached: ThinkingTurnSegment,
  incoming: ThinkingTurnSegment,
): ThinkingTurnSegment {
  if (cached.kind !== incoming.kind) {
    return incoming;
  }

  if (cached.kind === 'phase-text' && incoming.kind === 'phase-text') {
    const cachedText = cached.text.trim();
    const incomingText = incoming.text.trim();
    return {
      ...incoming,
      text: incomingText.length >= cachedText.length ? incoming.text : cached.text,
    };
  }

  const cachedGroup = cached as ThinkingToolGroupSegment;
  const incomingGroup = incoming as ThinkingToolGroupSegment;
  const mergedTimeline = mergeTimelineMonotonic(cachedGroup.timeline, incomingGroup.timeline);

  let state = incomingGroup.state;
  if (cachedGroup.state === 'completed' && incomingGroup.state === 'active') {
    state = 'completed';
  } else if (cachedGroup.state === 'completed') {
    state = 'completed';
  }

  return {
    ...incomingGroup,
    timeline: mergedTimeline,
    state,
  };
}

/**
 * 按 segment.key 单调合并：保留用户已看到的顺序，解析器压栈时不丢已完成摘要批次。
 */
export function mergeSegmentsMonotonic(
  cached: ThinkingTurnSegment[],
  incoming: ThinkingTurnSegment[],
): ThinkingTurnSegment[] {
  if (cached.length === 0) return incoming;
  if (incoming.length === 0) return cached;

  // 解析器已产出图二交替顺序时以 incoming 为准，避免 phase-text 被 append 到两个摘要之后
  if (isChronologicallyOrderedLayout(incoming) && incoming.length >= cached.length) {
    const cachedByKey = new Map(cached.map((segment) => [segment.key, segment]));
    const ordered = incoming.map((segment) => {
      const previous = cachedByKey.get(segment.key);
      return previous ? mergeTurnSegmentMonotonic(previous, segment) : segment;
    });
    relocateInterruptPhaseBetweenAdjacentToolGroups(ordered);
    mergeAdjacentOrphanedThinkingAndToolGroups(ordered);
    pruneDuplicateToolOnlyGroups(ordered);
    return ordered;
  }

  const incomingByKey = new Map(incoming.map((segment) => [segment.key, segment]));
  const merged: ThinkingTurnSegment[] = [];
  const seen = new Set<string>();

  for (const segment of cached) {
    const updated = incomingByKey.get(segment.key);
    if (updated) {
      merged.push(mergeTurnSegmentMonotonic(segment, updated));
      seen.add(segment.key);
    } else {
      merged.push(segment);
    }
  }

  for (const segment of incoming) {
    if (!seen.has(segment.key)) {
      merged.push(segment);
    }
  }

  relocateInterruptPhaseBetweenAdjacentToolGroups(merged);
  mergeAdjacentOrphanedThinkingAndToolGroups(merged);
  pruneDuplicateToolOnlyGroups(merged);
  return merged;
}
