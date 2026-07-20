/**
 * done-segment-normalize — 完成态一次性整理 segments（live 不调用）
 *
 * 仅处理「旁白与 tool-group 堆叠、需拆成 phase ↔ 摘要交替」的 done 场景；
 * live 顺序完全由事件流 + batch flush 决定，不做事后 zip/rebuild。
 */
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import {
  hasToolEventsAfter,
  isEchoOfUserQuery,
  isLikelyDeliverableReply,
  shouldPromoteTextToFinalReply,
} from '@/pages/Chat/thinking/classify-text';
import type { RawTurnEvent, ThinkingTurnSegment } from '@/pages/Chat/thinking/types';
import { OPENING_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';
import {
  toolGroupSegmentKey,
} from '@/pages/Chat/thinking/batch-segments';
import { rebalanceThinkingTimelineForDisplay } from '@/pages/Chat/thinking-turn-segments';

export function isFigureTwoAlternatingLayout(segments: ThinkingTurnSegment[]): boolean {
  if (segments.length < 2) return false;
  for (let index = 0; index < segments.length; index += 1) {
    const expectedKind = index % 2 === 0 ? 'phase-text' : 'tool-group';
    if (segments[index]?.kind !== expectedKind) return false;
  }
  return true;
}

/** 相邻 segment 种类不重复（允许 tool-group 打头，不强制奇偶 phase-first） */
export function isChronologicallyOrderedLayout(segments: ThinkingTurnSegment[]): boolean {
  if (segments.length < 2) return false;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.kind === segments[index + 1]?.kind) return false;
  }
  return true;
}

/** live 已按时间切出的多批结构 → done 不再 rebuild，避免旁白/次数被替换消失 */
export function shouldSkipDoneSegmentNormalize(
  segments: ThinkingTurnSegment[],
  mergedEvents?: RawTurnEvent[],
  lastTextEventIndex?: number,
): boolean {
  const toolGroupCount = segments.filter((segment) => segment.kind === 'tool-group').length;
  const interleaved =
    mergedEvents !== undefined
    && lastTextEventIndex !== undefined
    && hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex);

  if (isChronologicallyOrderedLayout(segments)) {
    // [phase, monolithic group] + 事件流有批次间旁白 → 允许 normalize 拆成图二
    if (toolGroupCount === 1 && interleaved) return false;
    return true;
  }

  if (toolGroupCount >= 2) return true;

  const hasBatchInterruptPhase = segments.some(
    (segment) =>
      segment.kind === 'phase-text'
      && (segment.key.startsWith('phase-text-after-')
        || segment.key.startsWith('phase-text-pending-')),
  );

  // 单组且含 tool：无批次间打断旁白时保留 monolithic，避免比例切分丢工具
  if (toolGroupCount === 1) {
    const group = segments.find(
      (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
        segment.kind === 'tool-group',
    );
    if (group?.timeline.some((item) => item.type === 'tool') && !hasBatchInterruptPhase) {
      return true;
    }
  }

  if (hasBatchInterruptPhase && toolGroupCount >= 2) return true;

  return false;
}

function countTimelineTools(timeline: ThinkingTimelineItem[]): number {
  return timeline.filter((item) => item.type === 'tool').length;
}

/** done normalize 取更完整的 timeline，避免 mergedEvents 短于 live parse 结果 */
function pickRicherProcessTimeline(
  fromEvents: ThinkingTimelineItem[],
  fromGroup: ThinkingTimelineItem[],
): ThinkingTimelineItem[] {
  const eventToolCount = countTimelineTools(fromEvents);
  const groupToolCount = countTimelineTools(fromGroup);
  if (groupToolCount > eventToolCount) return fromGroup;
  if (eventToolCount > groupToolCount) return fromEvents;
  if (fromGroup.length >= fromEvents.length) return fromGroup;
  return fromEvents.length > 0 ? fromEvents : fromGroup;
}

function rebuildDoneSegmentsFromEvents(
  events: RawTurnEvent[],
  lastTextEventIndex: number,
  precedingUserText?: string | null,
): ThinkingTurnSegment[] {
  const segments: ThinkingTurnSegment[] = [];
  let currentGroup: ThinkingTimelineItem[] = [];
  let groupIndex = 0;

  const flushBatch = () => {
    if (currentGroup.length === 0) return;
    segments.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(currentGroup, groupIndex),
      timeline: rebalanceThinkingTimelineForDisplay(currentGroup),
      state: 'completed',
    });
    groupIndex += 1;
    currentGroup = [];
  };

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    if (event.type === 'text') {
      const trimmed = event.text.trim();
      if (!trimmed) continue;
      if (
        shouldPromoteTextToFinalReply(
          trimmed,
          false,
          eventIndex,
          lastTextEventIndex,
          hasToolEventsAfter(events, eventIndex),
        )
      ) {
        continue;
      }
      if (isLikelyDeliverableReply(trimmed)) continue;
      if (isEchoOfUserQuery(trimmed, precedingUserText)) continue;

      flushBatch();
      const hasOpeningPhaseText = segments.some((segment) => segment.kind === 'phase-text');
      segments.push({
        kind: 'phase-text',
        key: hasOpeningPhaseText
          ? `phase-text-after-${groupIndex - 1}`
          : OPENING_PHASE_TEXT_KEY,
        text: trimmed,
      });
      continue;
    }

    if (event.type === 'thinking') {
      currentGroup = appendThinkingToGroup(currentGroup, event.content);
      continue;
    }

    if (event.type === 'tool') {
      currentGroup = appendToolToGroup(currentGroup, event);
    }
  }

  flushBatch();
  return segments;
}

function distributeTimelineAcrossPhaseTexts(
  phaseTexts: Extract<ThinkingTurnSegment, { kind: 'phase-text' }>[],
  timeline: ThinkingTimelineItem[],
): ThinkingTurnSegment[] {
  if (phaseTexts.length === 0) return [];

  const result: ThinkingTurnSegment[] = [];
  let timelineIndex = 0;

  for (let phaseIndex = 0; phaseIndex < phaseTexts.length; phaseIndex += 1) {
    result.push(phaseTexts[phaseIndex]!);

    const remainingItems = timeline.length - timelineIndex;
    const remainingPhases = phaseTexts.length - phaseIndex;
    const batchSize = Math.ceil(remainingItems / remainingPhases);
    const batch = timeline.slice(timelineIndex, timelineIndex + batchSize);
    timelineIndex += batchSize;

    if (batch.length === 0) continue;

    result.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(batch, phaseIndex),
      timeline: rebalanceThinkingTimelineForDisplay(batch),
      state: 'completed',
    });
  }

  return result;
}

function buildProcessTimelineFromEvents(events: RawTurnEvent[]): ThinkingTimelineItem[] {
  const items: ThinkingTimelineItem[] = [];
  let toolIndex = 0;

  for (const event of events) {
    if (event.type === 'thinking') {
      items.push({ type: 'thinking', content: event.content });
      continue;
    }
    if (event.type === 'tool') {
      toolIndex += 1;
      items.push({
        type: 'tool',
        index: toolIndex,
        id: event.id || `tool-${toolIndex}`,
        name: event.name,
        input: event.input,
      });
    }
  }

  return items;
}

function hasInterleavedNarrationTexts(
  events: RawTurnEvent[],
  lastTextEventIndex: number,
): boolean {
  let seenThinkingOrTool = false;
  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex]!;
    if (event.type === 'thinking' || event.type === 'tool') {
      seenThinkingOrTool = true;
      continue;
    }
    if (event.type !== 'text') continue;
    if (!seenThinkingOrTool) continue;
    if (eventIndex === lastTextEventIndex) continue;
    if (event.text.trim().length === 0) continue;
    return true;
  }
  return false;
}

function appendThinkingToGroup(
  group: ThinkingTimelineItem[],
  content: string,
): ThinkingTimelineItem[] {
  return [...group, { type: 'thinking' as const, content }];
}

function appendToolToGroup(
  group: ThinkingTimelineItem[],
  tool: { id: string; name: string; input: unknown },
): ThinkingTimelineItem[] {
  const toolIndex = group.filter((item) => item.type === 'tool').length + 1;
  return [
    ...group,
    {
      type: 'tool' as const,
      index: toolIndex,
      id: tool.id || `tool-${toolIndex}`,
      name: tool.name,
      input: tool.input,
    },
  ];
}

/**
 * 完成态：堆叠旁白 + 单一/交错 tool 组 → 图二 phase ↔ 一级摘要交替。
 * 已是交替布局则跳过。
 */
export function normalizeDoneThinkingSegments(
  segments: ThinkingTurnSegment[],
  mergedEvents: RawTurnEvent[],
  lastTextEventIndex: number,
  precedingUserText?: string | null,
): void {
  if (shouldSkipDoneSegmentNormalize(segments, mergedEvents, lastTextEventIndex)) return;

  const toolGroupCount = segments.filter((segment) => segment.kind === 'tool-group').length;
  const phaseTextCount = segments.filter((segment) => segment.kind === 'phase-text').length;
  const interleaved = hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex);
  if (toolGroupCount === 0) return;
  if (!interleaved && phaseTextCount < 2) return;

  const phaseTexts = segments.filter(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'phase-text' }> =>
      segment.kind === 'phase-text',
  );
  const group = segments.find(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
      segment.kind === 'tool-group',
  );
  if (!group) return;

  const processTimeline = buildProcessTimelineFromEvents(mergedEvents);
  const timeline = pickRicherProcessTimeline(processTimeline, group.timeline);

  // 单一 monolithic 组 + 多条旁白：有事件交错则 rebuild；纯堆叠才按比例切分
  const replacement =
    toolGroupCount === 1
      && hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex)
        ? rebuildDoneSegmentsFromEvents(mergedEvents, lastTextEventIndex, precedingUserText)
        : toolGroupCount === 1
          && !hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex)
          ? distributeTimelineAcrossPhaseTexts(phaseTexts, timeline)
          : hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex)
            ? rebuildDoneSegmentsFromEvents(mergedEvents, lastTextEventIndex, precedingUserText)
            : distributeTimelineAcrossPhaseTexts(phaseTexts, timeline);

  if (replacement.length === 0) return;
  segments.splice(0, segments.length, ...replacement);
}
