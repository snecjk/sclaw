import type { ContentBlock, RawMessage } from '@/stores/chat';
import { collectToolUpdates } from '@/stores/chat/helpers';
import {
  isRedundantThinking,
  pickTimelineSourceMessages,
  type TurnTimelineEntry,
} from '@/pages/Chat/chat-display';
import {
  extractText,
  extractToolUse,
  type ThinkingTimelineItem,
} from '@/pages/Chat/message-utils';
import { liveTextFull, liveTextTail, readLiveStreamParts } from '../../../shared/chat-live-append';
import {
  mergeAdjacentOrphanedThinkingAndToolGroups,
  relocateInterruptPhaseBetweenAdjacentToolGroups,
} from '@/pages/Chat/thinking/adjacent-group-phase';
import {
  isConflictingToolInput,
  mergeToolInput,
  thinkingTimelineToolIdentityKey,
} from '@/lib/tool-input-merge';
import {
  isStableToolId,
  resolveStreamingToolId,
  shouldAppendStreamingExtraTool,
  streamingToolMatchesTimelineTool,
} from '@/lib/thinking-timeline-active';
import {
  applyTurnPartsToParsedTurn,
} from '@/pages/Chat/thinking/turn-part-adapter';
import {
  appendInterruptedPart,
  reduceTurnParts,
} from '@/pages/Chat/thinking/turn-part-reducer';
import {
  dedupePhaseTextsAgainstFinalReply,
  dedupePhaseTextsEchoingUserQuery,
  finalizeReplyText,
  findLastTextEventIndex,
  hasToolEventsAfter,
  isEchoOfUserQuery,
  isClaudeRuntimeControlText,
  isLikelyDeliverableReply,
  mergeFinalReplyCandidate,
  reclaimLeadingDeliverablePhaseText,
  shouldPromoteTextToFinalReply,
} from '@/pages/Chat/thinking/classify-text';
import { applyTextOwnershipToParsedTurn } from '@/pages/Chat/thinking/text-ownership';
import {
  type EngineProfile,
  resolveEngineProfile,
} from '@/pages/Chat/thinking/engine-profiles';
import type {
  ParseThinkingTurnLayoutOptions,
  ParseThinkingTurnStreamingTool,
  ParsedThinkingTurn,
  RawTurnEvent,
  ThinkingTurnSegment,
} from '@/pages/Chat/thinking/types';
import {
  flushCompletedToolGroup,
  groupHasTool,
  markToolGroupStreamStates,
  midPhaseTextKey,
  phaseTextKeyForRebuild,
  replaceOpeningPhaseTextSegment,
  toolGroupSegmentKey,
  upsertPhaseTextSegment,
} from '@/pages/Chat/thinking/batch-segments';
import {
  isChronologicallyOrderedLayout,
  normalizeDoneThinkingSegments,
  shouldSkipDoneSegmentNormalize,
} from '@/pages/Chat/thinking/done-segment-normalize';
import {
  OPENING_PHASE_TEXT_KEY,
} from '@/pages/Chat/thinking/types';

export type {
  ParseThinkingTurnLayoutOptions,
  ParseThinkingTurnStreamingTool,
  ParsedThinkingTurn,
  ThinkingPhaseTextSegment,
  ThinkingToolGroupSegment,
  ThinkingTurnSegment,
} from '@/pages/Chat/thinking/types';
export { OPENING_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';

type ContentBlock = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
};

function thinkingTimelineToolKey(tool: { id: string; name: string; input: unknown }): string {
  return thinkingTimelineToolIdentityKey({ id: tool.id, name: tool.name });
}

function collectTimelineTools(
  segments: ThinkingTurnSegment[],
  currentGroup: ThinkingTimelineItem[],
): Extract<ThinkingTimelineItem, { type: 'tool' }>[] {
  const tools: Extract<ThinkingTimelineItem, { type: 'tool' }>[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'tool-group') continue;
    for (const item of segment.timeline) {
      if (item.type === 'tool') tools.push(item);
    }
  }
  for (const item of currentGroup) {
    if (item.type === 'tool') tools.push(item);
  }
  return tools;
}

function isDuplicateToolEvent(
  tool: { id: string; name: string; input: unknown },
  seenToolKeys: Set<string>,
  seenStableIds: Set<string>,
): boolean {
  const key = thinkingTimelineToolKey(tool);
  if (seenToolKeys.has(key)) return true;

  if (isStableToolId(tool.id, tool.name)) {
    return seenStableIds.has(tool.id);
  }

  return false;
}

function registerToolEventKeys(
  tool: { id: string; name: string; input: unknown },
  seenToolKeys: Set<string>,
  seenStableIds: Set<string>,
): void {
  seenToolKeys.add(thinkingTimelineToolKey(tool));
  if (isStableToolId(tool.id, tool.name)) {
    seenStableIds.add(tool.id);
  }
}

function supplementalToolAlreadyPresent(
  tool: ParseThinkingTurnStreamingTool,
  segments: ThinkingTurnSegment[],
  currentGroup: ThinkingTimelineItem[],
  seenToolKeys: Set<string>,
): boolean {
  const id = resolveStreamingToolId(tool);
  const candidate = { id, name: tool.name, input: tool.input ?? null };
  const key = thinkingTimelineToolKey(candidate);
  if (seenToolKeys.has(key)) return true;

  const existing = collectTimelineTools(segments, currentGroup);
  return existing.some((item) => streamingToolMatchesTimelineTool(tool, item));
}

function rebalanceThinkingTimelineItems(timeline: ThinkingTimelineItem[]): ThinkingTimelineItem[] {
  const thinkings = timeline.filter(
    (item): item is Extract<ThinkingTimelineItem, { type: 'thinking' }> => item.type === 'thinking',
  );
  const tools = timeline.filter(
    (item): item is Extract<ThinkingTimelineItem, { type: 'tool' }> => item.type === 'tool',
  );
  if (thinkings.length === 0 || tools.length === 0) return timeline;

  const firstToolIdx = timeline.findIndex((item) => item.type === 'tool');
  if (firstToolIdx < 0) return timeline;

  const allThinkBeforeTools = timeline
    .slice(0, firstToolIdx)
    .every((item) => item.type === 'thinking');
  const allToolsAfterFirst = timeline
    .slice(firstToolIdx)
    .every((item) => item.type === 'tool');
  if (!allThinkBeforeTools || !allToolsAfterFirst) return timeline;

  // 单 tool 前堆叠多条 thinking（Claude bundle）→ 收成首尾两条，避免「思考 N 次」虚高
  if (tools.length === 1 && thinkings.length > 2) {
    return [thinkings[0]!, thinkings[thinkings.length - 1]!, ...tools];
  }

  const interleaved: ThinkingTimelineItem[] = [];
  const max = Math.max(thinkings.length, tools.length);
  for (let i = 0; i < max; i += 1) {
    if (thinkings[i]) interleaved.push(thinkings[i]!);
    if (tools[i]) {
      interleaved.push({
        ...tools[i]!,
        index: i + 1,
      });
    }
  }
  return interleaved;
}

/** 供 TimelineBody 流式合并后校正 think/tool 顺序 */
export function rebalanceThinkingTimelineForDisplay(
  timeline: ThinkingTimelineItem[],
): ThinkingTimelineItem[] {
  return rebalanceThinkingTimelineItems(timeline);
}

function rebalanceBundledThinkingTools(events: RawTurnEvent[]): RawTurnEvent[] {
  return events;
}

function appendSupplementalStreamingTools(
  segments: ThinkingTurnSegment[],
  pendingPreBatchTexts: string[],
  group: ThinkingTimelineItem[],
  groupIndex: number,
  streamingTools: ParseThinkingTurnStreamingTool[],
  seenToolKeys: Set<string>,
  engineProfile: EngineProfile,
): { currentGroup: ThinkingTimelineItem[]; groupIndex: number } {
  let currentGroup = group;
  let nextGroupIndex = groupIndex;
  const deferPreBatchUntilFirstGroup =
    engineProfile.name === 'claude' && !segments.some((segment) => segment.kind === 'tool-group');

  for (const tool of streamingTools) {
    if (supplementalToolAlreadyPresent(tool, segments, currentGroup, seenToolKeys)) {
      continue;
    }

    const id = resolveStreamingToolId(tool);
    const candidate = { id, name: tool.name, input: tool.input ?? null };

    if (
      !isStableToolId(id, tool.name)
      && seenToolKeys.has(`stable-name::${tool.name}`)
    ) {
      continue;
    }

    if (
      !groupHasTool(currentGroup)
      && pendingPreBatchTexts.length > 0
      && !deferPreBatchUntilFirstGroup
    ) {
      const phaseText = pendingPreBatchTexts.shift();
      if (phaseText) {
        upsertPhaseTextSegment(segments, phaseText, `phase-text-sup-before-${nextGroupIndex}`);
      }
    }

    if (groupHasTool(currentGroup) && pendingPreBatchTexts.length > 0) {
      currentGroup = flushCompletedToolGroup(currentGroup, segments, nextGroupIndex);
      nextGroupIndex += 1;
      const phaseText = pendingPreBatchTexts.shift();
      if (phaseText) {
        upsertPhaseTextSegment(segments, phaseText, `phase-text-sup-${nextGroupIndex}`);
      }
    }

    seenToolKeys.add(thinkingTimelineToolKey(candidate));
    if (isStableToolId(id, tool.name)) {
      seenToolKeys.add(`stable-name::${tool.name}`);
    }
    currentGroup = appendToolToGroup(currentGroup, candidate);
  }

  return {
    currentGroup: rebalanceThinkingTimelineForDisplay(currentGroup),
    groupIndex: nextGroupIndex,
  };
}

/** 流式 tool 仅有 name/id 时，用 streamingTools 缓存补全 input 供卡片展示 */
function enrichTimelineWithStreamingInputs(
  timeline: ThinkingTimelineItem[],
  streamingTools: ParseThinkingTurnStreamingTool[] | undefined,
): ThinkingTimelineItem[] {
  if (!streamingTools?.length) return timeline;

  const inputByKey = new Map<string, unknown>();
  for (const tool of streamingTools) {
    const keys = [
      tool.toolCallId,
      tool.id,
      tool.name,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    for (const key of keys) {
      if (tool.input !== undefined && tool.input !== null) {
        inputByKey.set(key, tool.input);
      }
    }
  }

  return timeline.map((item) => {
    if (item.type !== 'tool' || item.input != null) return item;
    const input =
      inputByKey.get(item.id)
      ?? inputByKey.get(item.name);
    if (input === undefined) return item;
    return { ...item, input };
  });
}

function enrichSegmentsWithStreamingInputs(
  segments: ThinkingTurnSegment[],
  streamingTools: ParseThinkingTurnStreamingTool[] | undefined,
): void {
  if (!streamingTools?.length) return;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment?.kind !== 'tool-group') continue;
    segments[i] = {
      ...segment,
      timeline: enrichTimelineWithStreamingInputs(segment.timeline, streamingTools),
    };
  }
}

function appendThinkingToGroup(
  group: ThinkingTimelineItem[],
  content: string,
  liveParts?: string[],
): ThinkingTimelineItem[] {
  // Claude 流式：同一规划句重述（含 tool 后复述）→ 更新已有 thinking，不新增「思考次数」
  for (let i = group.length - 1; i >= 0; i -= 1) {
    const item = group[i];
    if (item?.type !== 'thinking') continue;
    const sameLiveGrow = Boolean(liveParts?.length && item.liveParts?.length);
    if (!sameLiveGrow && !isRedundantThinking(item.content, content)) {
      // 正在生长的 live 块不要并进已经定稿的 thinking
      if (liveParts?.length) break;
      continue;
    }
    const next = [...group];
    next[i] = {
      type: 'thinking',
      content: liveParts?.length
        ? content
        : (content.length >= item.content.length ? content : item.content),
      liveParts: liveParts ?? item.liveParts,
    };
    return next;
  }

  return [
    ...group,
    {
      type: 'thinking',
      content,
      ...(liveParts?.length ? { liveParts } : {}),
    },
  ];
}

function rebuildDoneSegmentsFromEvents(
  events: RawTurnEvent[],
  lastTextEventIndex: number,
  precedingUserText?: string | null,
  isLiveStream = false,
): ThinkingTurnSegment[] {
  const segments: ThinkingTurnSegment[] = [];
  let currentGroup: ThinkingTimelineItem[] = [];
  let groupIndex = 0;

  const flushBatch = () => {
    if (currentGroup.length === 0) return;
    segments.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(currentGroup, groupIndex),
      timeline: rebalanceThinkingTimelineItems(currentGroup),
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
      if (isClaudeRuntimeControlText(trimmed)) continue;
      if (
        shouldPromoteTextToFinalReply(
          trimmed,
          isLiveStream,
          eventIndex,
          lastTextEventIndex,
          hasToolEventsAfter(events, eventIndex),
        )
      ) {
        continue;
      }
      if (!isLiveStream && isLikelyDeliverableReply(trimmed)) continue;
      // OpenClaw echo 用户原问，不应落成 phase-text
      if (isEchoOfUserQuery(trimmed, precedingUserText)) continue;

      flushBatch();
      segments.push({
        kind: 'phase-text',
        key: phaseTextKeyForRebuild(segments, groupIndex),
        text: trimmed,
      });
      continue;
    }

    if (event.type === 'thinking') {
      currentGroup = appendThinkingToGroup(currentGroup, event.content, event.liveParts);
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
      timeline: rebalanceThinkingTimelineItems(batch),
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
      items.push({
        type: 'thinking',
        content: event.content,
        liveParts: event.liveParts,
      });
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

/**
 * 完成态兜底：旁白全在 thinking 之前堆叠、且只有一个大 tool-group 时，
 * 按图二拆成 phase-text ↔ 一级摘要交替（非红色整体「思考 N 次」）。
 * 时序交错的数据走 rebuildDoneSegmentsFromEvents；纯堆叠走 distribute。
 */
function hasInterleavedNarrationTexts(
  events: RawTurnEvent[],
  lastTextEventIndex: number,
  isLiveStream: boolean,
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
    if (!isLiveStream && eventIndex === lastTextEventIndex) continue;
    const trimmed = event.text.trim();
    if (trimmed.length === 0) continue;
    if (
      isLiveStream
      && eventIndex === lastTextEventIndex
      && shouldPromoteTextToFinalReply(
        trimmed,
        true,
        eventIndex,
        lastTextEventIndex,
        hasToolEventsAfter(events, eventIndex),
      )
    ) {
      continue;
    }
    return true;
  }
  return false;
}

function areLivePhaseTextsStackedAtTail(segments: ThinkingTurnSegment[]): boolean {
  let index = segments.length - 1;
  while (index >= 0 && segments[index]?.kind === 'phase-text') {
    index -= 1;
  }
  const trailingPhaseCount = segments.length - 1 - index;
  if (trailingPhaseCount < 2) return false;

  const precedingGroupCount = segments
    .slice(0, index + 1)
    .filter((segment) => segment.kind === 'tool-group').length;
  return precedingGroupCount >= 1;
}

/** Claude 图一/二：单 tool + 多条尾部旁白已是目标布局，不再 zip / 按比例切 timeline */
function isSingleToolGroupWithTrailingPhaseTextsOnly(
  segments: ThinkingTurnSegment[],
): boolean {
  const toolGroups = segments.filter((segment) => segment.kind === 'tool-group');
  if (toolGroups.length !== 1) return false;

  const firstGroupIndex = segments.findIndex((segment) => segment.kind === 'tool-group');
  if (firstGroupIndex < 0) return false;

  for (let index = 0; index < firstGroupIndex; index += 1) {
    if (segments[index]?.kind === 'phase-text') return false;
  }

  const afterGroup = segments.slice(firstGroupIndex + 1);
  const trailingPhaseCount = afterGroup.filter((segment) => segment.kind === 'phase-text').length;
  if (trailingPhaseCount < 2) return false;
  if (!afterGroup.every((segment) => segment.kind === 'phase-text')) return false;

  const onlyGroup = toolGroups[0]!;
  const toolCount = onlyGroup.timeline.filter((item) => item.type === 'tool').length;
  return toolCount < trailingPhaseCount;
}

/** 多组摘要连续堆在前、旁白连续堆在尾（OpenClaw 流式常见） */
function countTrailingPhaseTexts(segments: ThinkingTurnSegment[]): number {
  let index = segments.length - 1;
  while (index >= 0 && segments[index]?.kind === 'phase-text') {
    index -= 1;
  }
  return segments.length - 1 - index;
}

function areToolGroupsStackedBeforeTrailingPhaseTexts(
  segments: ThinkingTurnSegment[],
  minTrailingPhases = 1,
): boolean {
  const trailingPhaseCount = countTrailingPhaseTexts(segments);
  if (trailingPhaseCount < minTrailingPhases) return false;

  const prefixEnd = segments.length - trailingPhaseCount - 1;
  const prefix = segments.slice(0, prefixEnd + 1);
  const groupCount = prefix.filter((segment) => segment.kind === 'tool-group').length;
  if (groupCount < 2) return false;

  const openingAtStart =
    prefix[0]?.kind === 'phase-text' && prefix[0].key === OPENING_PHASE_TEXT_KEY
      ? prefix[0]
      : null;
  const hasMidPrefixPhaseText = prefix.some(
    (segment, index) =>
      segment.kind === 'phase-text'
      && segment !== openingAtStart
      && prefix.slice(0, index).some((entry) => entry.kind === 'tool-group'),
  );
  return !hasMidPrefixPhaseText;
}

/**
 * [g1,g2,…,p1,p2,…] → [g1,p1,g2,p2,…]（旁白按序插回各批摘要之后）
 * 仅当摘要已在 segments 里拆成多组、旁白堆在尾部时适用。
 */
function zipStackedGroupsWithTrailingPhaseTexts(
  segments: ThinkingTurnSegment[],
): ThinkingTurnSegment[] | null {
  const trailingPhaseCount = countTrailingPhaseTexts(segments);
  if (trailingPhaseCount === 0) return null;

  const prefixEnd = segments.length - trailingPhaseCount - 1;
  const prefix = segments.slice(0, prefixEnd + 1);
  const trailingPhases = segments
    .slice(prefixEnd + 1)
    .filter(
      (segment): segment is Extract<ThinkingTurnSegment, { kind: 'phase-text' }> =>
        segment.kind === 'phase-text',
    );
  if (trailingPhases.length === 0) return null;

  const openingAtStart =
    prefix[0]?.kind === 'phase-text' && prefix[0].key === OPENING_PHASE_TEXT_KEY
      ? prefix[0]
      : null;
  const groups = prefix.filter(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
      segment.kind === 'tool-group',
  );
  if (groups.length < 2) return null;

  const hasMidPrefixPhaseText = prefix.some(
    (segment, index) =>
      segment.kind === 'phase-text'
      && segment !== openingAtStart
      && prefix.slice(0, index).some((entry) => entry.kind === 'tool-group'),
  );
  if (hasMidPrefixPhaseText) return null;

  const zipped: ThinkingTurnSegment[] = [];
  if (openingAtStart) {
    zipped.push(openingAtStart);
  }
  for (let index = 0; index < groups.length; index += 1) {
    zipped.push(groups[index]!);
    const phase = trailingPhases[index];
    if (phase) {
      zipped.push(phase);
    }
  }
  for (let index = groups.length; index < trailingPhases.length; index += 1) {
    zipped.push(trailingPhases[index]!);
  }
  return zipped;
}

/**
 * [g_big, p1, p2, …] → [g1, p1, g2, p2, …]
 * 旁白在事件流末尾、仅一个 monolithic tool-group 时，按旁白数量切分 timeline。
 */
function splitMonolithicGroupWithTrailingPhases(
  segments: ThinkingTurnSegment[],
): ThinkingTurnSegment[] | null {
  const trailingPhaseCount = countTrailingPhaseTexts(segments);
  if (trailingPhaseCount === 0) return null;

  const prefixEnd = segments.length - trailingPhaseCount - 1;
  const prefix = segments.slice(0, prefixEnd + 1);
  const trailingPhases = segments
    .slice(prefixEnd + 1)
    .filter(
      (segment): segment is Extract<ThinkingTurnSegment, { kind: 'phase-text' }> =>
        segment.kind === 'phase-text',
    );
  if (trailingPhases.length === 0) return null;

  const openingAtStart =
    prefix[0]?.kind === 'phase-text' && prefix[0].key === OPENING_PHASE_TEXT_KEY
      ? prefix[0]
      : null;
  const toolGroups = prefix.filter(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
      segment.kind === 'tool-group',
  );
  if (toolGroups.length !== 1) return null;

  const hasMidPrefixPhaseText = prefix.some(
    (segment, index) =>
      segment.kind === 'phase-text'
      && segment !== openingAtStart
      && prefix.slice(0, index).some((entry) => entry.kind === 'tool-group'),
  );
  if (hasMidPrefixPhaseText) return null;

  const monolithicGroup = toolGroups[0]!;
  const timeline = monolithicGroup.timeline;
  const batchCount = trailingPhases.length;
  const toolCount = timeline.filter((item) => item.type === 'tool').length;
  // 旁白条数多于 tool 时无法按批切分；保留 [g, p1, p2, …]（Claude 流式旁白队列）
  if (toolCount < batchCount) return null;

  const result: ThinkingTurnSegment[] = [];

  if (openingAtStart) {
    result.push(openingAtStart);
  }

  let timelineIndex = 0;
  for (let index = 0; index < batchCount; index += 1) {
    const remainingItems = timeline.length - timelineIndex;
    const remainingBatches = batchCount - index;
    const batchSize = Math.ceil(remainingItems / remainingBatches);
    const batch = timeline.slice(timelineIndex, timelineIndex + batchSize);
    timelineIndex += batchSize;

    if (batch.length === 0) continue;

    result.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(batch, index),
      timeline: rebalanceThinkingTimelineItems(batch),
      state: monolithicGroup.state,
    });
    result.push(trailingPhases[index]!);
  }

  for (let index = batchCount; index < trailingPhases.length; index += 1) {
    result.push(trailingPhases[index]!);
  }

  return result.length > 0 ? result : null;
}

function shouldReconcileFigureTwoLayout(
  segments: ThinkingTurnSegment[],
  isLiveStream: boolean,
): boolean {
  if (isChronologicallyOrderedLayout(segments)) return false;
  if (isSingleToolGroupWithTrailingPhaseTextsOnly(segments)) return false;

  const toolGroupCount = segments.filter((segment) => segment.kind === 'tool-group').length;
  const phaseTextCount = segments.filter((segment) => segment.kind === 'phase-text').length;
  if (toolGroupCount === 0 || phaseTextCount === 0) return false;

  if (isLiveStream) {
    return (
      areLivePhaseTextsStackedAtTail(segments)
      || areToolGroupsStackedBeforeTrailingPhaseTexts(segments)
    );
  }

  return phaseTextCount >= 2;
}

function splitStackedPhaseTextsIntoFigureTwoLayout(
  segments: ThinkingTurnSegment[],
  mergedEvents: RawTurnEvent[],
  lastTextEventIndex: number,
  precedingUserText?: string | null,
  isLiveStream = false,
): void {
  if (!shouldReconcileFigureTwoLayout(segments, isLiveStream)) return;

  const phaseTexts = segments.filter(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'phase-text' }> =>
      segment.kind === 'phase-text',
  );
  const group = segments.find(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
      segment.kind === 'tool-group',
  );
  if (!group) return;

  const zipReplacement = zipStackedGroupsWithTrailingPhaseTexts(segments);
  if (zipReplacement) {
    segments.splice(0, segments.length, ...zipReplacement);
    return;
  }

  const monolithicReplacement = splitMonolithicGroupWithTrailingPhases(segments);
  if (monolithicReplacement) {
    segments.splice(0, segments.length, ...monolithicReplacement);
    return;
  }

  const processTimeline = buildProcessTimelineFromEvents(mergedEvents);
  const replacement = hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex, isLiveStream)
    ? rebuildDoneSegmentsFromEvents(
      mergedEvents,
      lastTextEventIndex,
      precedingUserText,
      isLiveStream,
    )
    : distributeTimelineAcrossPhaseTexts(
      phaseTexts,
      processTimeline.length > 0 ? processTimeline : group.timeline,
    );

  if (replacement.length === 0) return;
  segments.splice(0, segments.length, ...replacement);
}

function appendToolToGroup(
  group: ThinkingTimelineItem[],
  tool: { id: string; name: string; input: unknown },
): ThinkingTimelineItem[] {
  const key = thinkingTimelineToolKey(tool);
  // identity 相同但 input 冲突 = 另一次调用（弱 id / 网关复用同一个 id），不能当重复丢掉。
  const exists = group.some(
    (item) =>
      item.type === 'tool'
      && thinkingTimelineToolKey({ id: item.id, name: item.name, input: item.input }) === key
      && !isConflictingToolInput(item.input, tool.input),
  );
  if (exists) return group;

  const toolIndex = group.filter((item) => item.type === 'tool').length + 1;
  return [
    ...group,
    {
      type: 'tool',
      index: toolIndex,
      id: tool.id || `tool-${toolIndex}`,
      name: tool.name,
      input: tool.input,
    },
  ];
}

function extractOrderedEventsFromMessage(message: RawMessage): RawTurnEvent[] {
  const events: RawTurnEvent[] = [];
  const msg = message as unknown as Record<string, unknown>;
  const content = msg.content;
  const capturedToolKeys = new Set<string>();

  if (typeof content === 'string') {
    const live = readLiveStreamParts(msg);
    if (live && (live.field === 'content' || live.blockIndex === null)) {
      // `_liveTail` 只给折叠预览；正文事件必须 join 全文，否则气泡会变成 96 字滑动截断。
      const text = liveTextFull(live.parts);
      if (text) events.push({ type: 'text', text });
      return events;
    }
    const text = extractText(message).trim();
    if (text) events.push({ type: 'text', text });
    return events;
  }

  if (!Array.isArray(content)) return events;

  let toolIndex = 0;
  const live = readLiveStreamParts(msg);
  for (const [blockIndex, block] of (content as ContentBlock[]).entries()) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const isGrow = live && live.field === 'text' && live.blockIndex === blockIndex;
      if (isGrow) {
        const text = liveTextFull(live.parts);
        if (text) events.push({ type: 'text', text });
        continue;
      }
      const text = extractText({ role: 'assistant', content: [{ type: 'text', text: block.text }] }).trim();
      if (text) events.push({ type: 'text', text });
      continue;
    }
    if (block.type === 'thinking') {
      const isGrow = live && live.field === 'thinking' && live.blockIndex === blockIndex;
      if (isGrow) {
        events.push({
          type: 'thinking',
          content: live.tail || liveTextTail(live.parts),
          liveParts: live.parts,
        });
        continue;
      }
      if (typeof block.thinking === 'string') {
        const trimmed = block.thinking.trim();
        if (trimmed) {
          events.push({ type: 'thinking', content: trimmed });
        }
      }
      continue;
    }
    if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
      toolIndex += 1;
      const id = block.id || `tool-${toolIndex}`;
      events.push({
        type: 'tool',
        id,
        name: block.name,
        input: block.input ?? block.arguments ?? null,
      });
      capturedToolKeys.add(id);
    }
  }

  for (const tool of extractToolUse(message)) {
    const key = tool.id || tool.name;
    if (capturedToolKeys.has(key)) continue;
    events.push({
      type: 'tool',
      id: tool.id || key,
      name: tool.name,
      input: tool.input ?? null,
    });
    capturedToolKeys.add(key);
  }

  return events;
}

/**
 * 事件提取按消息引用缓存：历史消息与已提交 snapshot 在流式期间引用稳定，
 * 每帧只重新提取正在生长的 streaming snapshot，冻结消息零成本。
 *
 * 指纹含 block 个数 + thinking/text 字符长度。原地加长同一块的 thinking
 * 字符串时 array.length 不变，必须把正文长度算进去，否则会打出旧事件。
 */
const orderedEventsByMessage = new WeakMap<
  RawMessage,
  { events: RawTurnEvent[]; fingerprint: string }
>();

/** 导出供缓存失效测试；禁止当作展示/协议字段。 */
export function messageContentCacheFingerprint(message: RawMessage): string {
  const live = readLiveStreamParts(message);
  const content = message.content;
  if (typeof content === 'string') return `s:${live?.length ?? content.length}`;
  if (!Array.isArray(content)) return live ? `live:${live.length}` : 'empty';
  let fingerprint = `n:${content.length}`;
  for (const [index, block] of content.entries()) {
    if (!block || typeof block !== 'object') {
      fingerprint += '|x';
      continue;
    }
    const record = block as Record<string, unknown>;
    const thinking = typeof record.thinking === 'string' ? record.thinking.length : 0;
    const text = typeof record.text === 'string' ? record.text.length : 0;
    const grow = live
      && ((live.field === 'thinking' && live.blockIndex === index)
        || (live.field === 'text' && live.blockIndex === index)
        || (live.field === 'content' && live.blockIndex === null));
    fingerprint += `|${String(record.type ?? '')}:${grow ? live.length : thinking}:${text}`;
  }
  return fingerprint;
}

function extractOrderedEventsFromMessageCached(message: RawMessage): RawTurnEvent[] {
  const fingerprint = messageContentCacheFingerprint(message);
  const cached = orderedEventsByMessage.get(message);
  if (cached && cached.fingerprint === fingerprint) return cached.events;
  const events = rebalanceBundledThinkingTools(extractOrderedEventsFromMessage(message));
  orderedEventsByMessage.set(message, { events, fingerprint });
  return events;
}

/**
 * Claude 图二：仅把 opening 旁白挪到首个一级摘要之下（不移动批次间旁白）。
 */
function moveOpeningPhaseTextBelowFirstGroup(segments: ThinkingTurnSegment[]): void {
  const firstGroupIndex = segments.findIndex((segment) => segment.kind === 'tool-group');
  if (firstGroupIndex <= 0) return;

  const openingIndex = segments.findIndex(
    (segment) =>
      segment.kind === 'phase-text' && segment.key === OPENING_PHASE_TEXT_KEY,
  );
  if (openingIndex < 0 || openingIndex >= firstGroupIndex) return;

  const opening = segments[openingIndex];
  if (opening?.kind !== 'phase-text') return;

  segments.splice(openingIndex, 1);
  const groupIndex = segments.findIndex((segment) => segment.kind === 'tool-group');
  segments.splice(groupIndex + 1, 0, opening);
}

function hasAdjacentToolGroupsWithoutPhase(segments: ThinkingTurnSegment[]): boolean {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.kind !== 'tool-group') continue;
    if (segments[index + 1]?.kind !== 'tool-group') continue;
    return true;
  }
  return false;
}

/** 图二：pending 旁白优先插入相邻一级摘要之间，避免落到整段思考区最底部 */
function flushPendingIntoAdjacentGroupGaps(
  segments: ThinkingTurnSegment[],
  pendingPreBatchTexts: string[],
): void {
  if (pendingPreBatchTexts.length === 0) return;

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.kind !== 'tool-group') continue;
    if (segments[index + 1]?.kind !== 'tool-group') continue;

    let insertAt = index + 1;
    while (pendingPreBatchTexts.length > 0) {
      const phaseText = pendingPreBatchTexts.shift();
      if (!phaseText) continue;
      segments.splice(insertAt, 0, {
        kind: 'phase-text',
        key: midPhaseTextKey(segments),
        text: phaseText,
      });
      insertAt += 1;
    }
    return;
  }
}

function mergeRicherRebuiltToolTimelines(
  source: ThinkingTurnSegment[],
  rebuilt: ThinkingTurnSegment[],
): ThinkingTurnSegment[] {
  const sourceGroups = source.filter(
    (segment): segment is Extract<ThinkingTurnSegment, { kind: 'tool-group' }> =>
      segment.kind === 'tool-group',
  );
  let groupCursor = 0;

  return rebuilt.map((segment) => {
    if (segment.kind !== 'tool-group') return segment;
    const match = sourceGroups[groupCursor] ?? sourceGroups[sourceGroups.length - 1];
    groupCursor += 1;
    if (match?.kind !== 'tool-group') return segment;

    const sourceToolCount = match.timeline.filter((item) => item.type === 'tool').length;
    const rebuiltToolCount = segment.timeline.filter((item) => item.type === 'tool').length;
    const timeline =
      sourceToolCount >= rebuiltToolCount
        ? match.timeline
        : segment.timeline;

    return {
      ...segment,
      timeline: rebalanceThinkingTimelineForDisplay(timeline),
      state: match.state,
    };
  });
}

/**
 * 多 snapshot 流式偶发 [摘要][摘要] 缺旁白：用事件流重建 phase ↔ 摘要交替，并保留更完整的 timeline。
 */
function reconcileAdjacentToolGroupsFromEvents(
  segments: ThinkingTurnSegment[],
  mergedEvents: RawTurnEvent[],
  lastTextEventIndex: number,
  isLiveStream: boolean,
  precedingUserText?: string | null,
): void {
  if (!hasAdjacentToolGroupsWithoutPhase(segments)) return;
  if (!hasInterleavedNarrationTexts(mergedEvents, lastTextEventIndex, isLiveStream)) return;

  const rebuilt = rebuildDoneSegmentsFromEvents(
    mergedEvents,
    lastTextEventIndex,
    precedingUserText,
    isLiveStream,
  );
  if (rebuilt.length === 0) return;

  const rebuiltHasInterruptPhase = rebuilt.some(
    (segment, index) =>
      segment.kind === 'phase-text'
      && rebuilt[index - 1]?.kind === 'tool-group'
      && rebuilt[index + 1]?.kind === 'tool-group',
  );
  if (!rebuiltHasInterruptPhase) return;

  segments.splice(
    0,
    segments.length,
    ...mergeRicherRebuiltToolTimelines(segments, rebuilt),
  );
}

function ensureDeferredPhaseTextsBelowFirstToolGroup(
  segments: ThinkingTurnSegment[],
  openingText: string | null,
  pendingPreBatchTexts: string[],
): void {
  const trimmedOpening = openingText?.trim() ?? '';
  const hasOpeningSegment = segments.some(
    (segment) =>
      segment.kind === 'phase-text' && segment.key === OPENING_PHASE_TEXT_KEY,
  );
  const needsOpeningInsert = trimmedOpening.length > 0 && !hasOpeningSegment;
  const needsPendingInsert = pendingPreBatchTexts.length > 0;
  if (isChronologicallyOrderedLayout(segments) && !needsOpeningInsert && !needsPendingInsert) {
    return;
  }

  const firstGroupIndex = segments.findIndex((segment) => segment.kind === 'tool-group');
  if (firstGroupIndex < 0) return;

  moveOpeningPhaseTextBelowFirstGroup(segments);

  let insertAt = segments.findIndex((segment) => segment.kind === 'tool-group') + 1;
  if (needsOpeningInsert) {
    segments.splice(insertAt, 0, {
      kind: 'phase-text',
      key: OPENING_PHASE_TEXT_KEY,
      text: trimmedOpening,
    });
    insertAt += 1;
  }

  while (pendingPreBatchTexts.length > 0) {
    const phaseText = pendingPreBatchTexts.shift();
    if (!phaseText) continue;
    segments.splice(insertAt, 0, {
      kind: 'phase-text',
      key: midPhaseTextKey(segments),
      text: phaseText,
    });
    insertAt += 1;
  }
}

function turnHasThinkingContent(
  segments: ThinkingTurnSegment[],
  currentGroup: ThinkingTimelineItem[],
): boolean {
  if (currentGroup.some((item) => item.type === 'thinking')) return true;
  return segments.some(
    (segment) =>
      segment.kind === 'tool-group'
      && segment.timeline.some((item) => item.type === 'thinking'),
  );
}

/**
 * 图一开场白：首批 tool 到达前只展示一条 text。
 * Claude 常连发多条 text-only 消息后再一次性吐 thinking/tool，其余先入队。
 */
function handlePreBatchText(
  segments: ThinkingTurnSegment[],
  text: string,
  openingText: string | null,
  pendingPreBatchTexts: string[],
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return openingText;

  if (openingText === null) {
    upsertPhaseTextSegment(segments, trimmed, OPENING_PHASE_TEXT_KEY);
    return trimmed;
  }

  if (trimmed.startsWith(openingText) || openingText.startsWith(trimmed)) {
    const merged = trimmed.length >= openingText.length ? trimmed : openingText;
    replaceOpeningPhaseTextSegment(segments, merged);
    return merged;
  }

  if (!pendingPreBatchTexts.includes(trimmed)) {
    pendingPreBatchTexts.push(trimmed);
  }
  return openingText;
}

/** Claude 图二：首批 tool 前只记 openingText，不落 segment，避免旁白先顶在摘要上再跳动 */
function trackClaudeDeferredOpeningText(
  text: string,
  openingText: string | null,
  pendingPreBatchTexts: string[],
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return openingText;

  if (openingText === null) {
    return trimmed;
  }

  if (trimmed.startsWith(openingText) || openingText.startsWith(trimmed)) {
    return trimmed.length >= openingText.length ? trimmed : openingText;
  }

  if (!pendingPreBatchTexts.includes(trimmed)) {
    pendingPreBatchTexts.push(trimmed);
  }
  return openingText;
}

/** Claude 多条 pre-batch text + 一批 tool 时，按图二在 tool 组之间插入阶段短 text */
function interleavePendingTextBeforeNextToolGroup(
  segments: ThinkingTurnSegment[],
  pendingPreBatchTexts: string[],
  currentGroup: ThinkingTimelineItem[],
  groupIndex: number,
): { currentGroup: ThinkingTimelineItem[]; groupIndex: number } {
  if (pendingPreBatchTexts.length === 0 || !groupHasTool(currentGroup)) {
    return { currentGroup, groupIndex };
  }

  const phaseText = pendingPreBatchTexts.shift();
  const flushedGroup = flushCompletedToolGroup(currentGroup, segments, groupIndex);
  if (phaseText) {
    upsertPhaseTextSegment(segments, phaseText, `phase-text-pending-${groupIndex}`);
  }

  return {
    currentGroup: flushedGroup,
    groupIndex: groupIndex + 1,
  };
}

/** 跨多条 assistant snapshot 合并事件：tool 按 id 去重，text 走 upsert，thinking 折叠冗余 */
function mergeRawTurnEvents(
  merged: RawTurnEvent[],
  events: RawTurnEvent[],
  seenToolKeys: Set<string>,
  seenStableIds: Set<string>,
): void {
  const findLastTextEventIndex = (): number => {
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (merged[i]?.type === 'text') return i;
    }
    return -1;
  };

  for (const event of events) {
    if (event.type === 'tool') {
      const identityKey = thinkingTimelineToolIdentityKey(event);
      let mergedExisting = false;
      /**
       * 同 identity 但 input 互相冲突 —— 说明这是另一次调用，不是同一次的另一份快照。
       * id 唯一性不可信：弱 id（id === name）之外，网关适配出来的 `toolu_<Name>_0`
       * 也会被一整轮的不同命令共用，一律合并会把工具列表整段吞掉。
       */
      let sawConflictingCall = false;
      for (let i = merged.length - 1; i >= 0; i -= 1) {
        const candidate = merged[i];
        if (candidate?.type !== 'tool') continue;
        const sameIdentity =
          thinkingTimelineToolIdentityKey(candidate) === identityKey
          || (isStableToolId(event.id, event.name) && candidate.id === event.id);
        if (!sameIdentity) continue;
        if (isConflictingToolInput(candidate.input, event.input)) {
          sawConflictingCall = true;
          continue;
        }
        const updatedEvent: RawTurnEvent = {
          ...candidate,
          input: mergeToolInput(candidate.input, event.input),
        };
        merged[i] = updatedEvent;
        registerToolEventKeys(updatedEvent, seenToolKeys, seenStableIds);
        mergedExisting = true;
        break;
      }
      if (mergedExisting) continue;

      if (!sawConflictingCall && isDuplicateToolEvent(event, seenToolKeys, seenStableIds)) {
        continue;
      }
      registerToolEventKeys(event, seenToolKeys, seenStableIds);
      merged.push(event);
      continue;
    }

    if (event.type === 'thinking') {
      const prev = merged[merged.length - 1];
      if (prev?.type === 'thinking' && isRedundantThinking(prev.content, event.content)) {
        merged[merged.length - 1] = {
          type: 'thinking',
          content: event.content.length >= prev.content.length ? event.content : prev.content,
        };
        continue;
      }

      let mergedIntoExisting = false;
      for (let i = merged.length - 1; i >= 0; i -= 1) {
        const candidate = merged[i];
        if (candidate?.type !== 'thinking') continue;
        if (!isRedundantThinking(candidate.content, event.content)) continue;
        merged[i] = {
          type: 'thinking',
          content:
            event.content.length >= candidate.content.length
              ? event.content
              : candidate.content,
        };
        mergedIntoExisting = true;
        break;
      }
      if (mergedIntoExisting) continue;

      merged.push(event);
      continue;
    }

    const lastTextIndex = findLastTextEventIndex();
    const lastText = lastTextIndex >= 0 ? merged[lastTextIndex] : null;
    if (lastText?.type === 'text') {
      if (lastText.text === event.text) continue;
      if (event.text.startsWith(lastText.text)) {
        merged[lastTextIndex] = { type: 'text', text: event.text };
        continue;
      }
      if (lastText.text.startsWith(event.text)) continue;
    }

    if (merged.some((entry) => entry.type === 'text' && entry.text === event.text)) continue;

    merged.push(event);
  }
}

function extractToolEventsFromToolResultMessage(message: RawMessage): RawTurnEvent[] {
  const events: RawTurnEvent[] = [];
  for (const update of collectToolUpdates(message, 'final')) {
    if (!update.name) continue;
    events.push({
      type: 'tool',
      id: update.toolCallId || update.id || update.name,
      name: update.name,
      input: update.input ?? null,
    });
  }
  return events;
}

/**
 * 按 session 时间线合并：picked assistant 事件 + 折叠 snapshot 之间的 tool_result 工具。
 * picked 与 chronological 的 message 可能不是同一引用（stream snapshot / store 副本），按 id 对齐。
 */
function buildPickedAssistantLookup(pickedMessages: RawMessage[]): {
  refs: Set<RawMessage>;
  ids: Set<string>;
} {
  const refs = new Set(pickedMessages);
  const ids = new Set<string>();
  for (const message of pickedMessages) {
    if (typeof message.id === 'string' && message.id.length > 0) {
      ids.add(message.id);
    }
  }
  return { refs, ids };
}

function chronologicalAssistantInPickedTurn(
  entryMessage: RawMessage,
  picked: { refs: Set<RawMessage>; ids: Set<string> },
): boolean {
  if (picked.refs.has(entryMessage)) return true;
  const id = entryMessage.id;
  return typeof id === 'string' && id.length > 0 && picked.ids.has(id);
}

function mergeEventsFromChronologicalTurn(
  pickedMessages: RawMessage[],
  chronologicalEntries: TurnTimelineEntry[],
): RawTurnEvent[] {
  const picked = buildPickedAssistantLookup(pickedMessages);
  const merged: RawTurnEvent[] = [];
  const seenToolKeys = new Set<string>();
  const seenStableIds = new Set<string>();
  const mergedAssistantRefs = new Set<RawMessage>();
  const mergedAssistantIds = new Set<string>();

  for (const entry of chronologicalEntries) {
    if (entry.kind === 'assistant') {
      if (!chronologicalAssistantInPickedTurn(entry.message, picked)) continue;
      mergedAssistantRefs.add(entry.message);
      if (typeof entry.message.id === 'string' && entry.message.id.length > 0) {
        mergedAssistantIds.add(entry.message.id);
      }
      const events = extractOrderedEventsFromMessageCached(entry.message);
      mergeRawTurnEvents(merged, events, seenToolKeys, seenStableIds);
      continue;
    }

    const toolEvents = extractToolEventsFromToolResultMessage(entry.message);
    mergeRawTurnEvents(merged, toolEvents, seenToolKeys, seenStableIds);
  }

  // During a live run the persisted session chronology can lag behind the
  // canonical streaming overlay. Chronology enriches ordering with tool_result
  // rows, but it must never become an allow-list that drops newer assistant
  // snapshots. Append picked live messages that history has not observed yet;
  // mergeRawTurnEvents keeps tool/text snapshots deduplicated for both engines.
  for (const message of pickedMessages) {
    const alreadyMerged = mergedAssistantRefs.has(message)
      || (typeof message.id === 'string' && message.id.length > 0 && mergedAssistantIds.has(message.id));
    if (alreadyMerged) continue;
    const events = extractOrderedEventsFromMessageCached(message);
    mergeRawTurnEvents(merged, events, seenToolKeys, seenStableIds);
  }

  return merged;
}

function mergeEventsFromPickedMessages(picked: RawMessage[]): RawTurnEvent[] {
  const merged: RawTurnEvent[] = [];
  const seenToolKeys = new Set<string>();
  const seenStableIds = new Set<string>();

  for (const message of picked) {
    const events = extractOrderedEventsFromMessageCached(message);
    mergeRawTurnEvents(merged, events, seenToolKeys, seenStableIds);
  }

  return merged;
}

/** Phase 2/4：供 TurnPart reducer 使用的 merged events（与 parse 同源） */
export function buildMergedRawTurnEvents(
  messages: RawMessage[],
  options: Pick<ParseThinkingTurnLayoutOptions, 'isLiveStream' | 'chronologicalEntries'>,
): RawTurnEvent[] {
  const picked = pickTimelineSourceMessages(messages);
  if (picked.length === 0) return [];

  const pickedFromMessages = mergeEventsFromPickedMessages(picked);
  // live / history 共用 chronological 合并，避免流式期间短 text 堆叠、切会话后才分段
  let mergedEvents =
    (options.chronologicalEntries?.length ?? 0) > 0
      ? mergeEventsFromChronologicalTurn(picked, options.chronologicalEntries!)
      : pickedFromMessages;
  if (
    (options.chronologicalEntries?.length ?? 0) > 0
    && mergedEvents.length === 0
    && pickedFromMessages.length > 0
  ) {
    mergedEvents = pickedFromMessages;
  }
  return mergedEvents;
}

function findLastThinkingOnlyToolGroupIndex(segments: ThinkingTurnSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.kind !== 'tool-group') continue;
    if (groupHasTool(segment.timeline)) continue;
    if (!segment.timeline.some((item) => item.type === 'thinking')) continue;
    return index;
  }
  return -1;
}

function findLastToolGroupWithToolsIndex(segments: ThinkingTurnSegment[]): number {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.kind === 'tool-group' && groupHasTool(segment.timeline)) {
      return index;
    }
  }
  return -1;
}

/** 将 trailing thinking 并入最近一批含 tool 的摘要（去重后 rebalance） */
function mergeThinkingTimelineIntoLastToolGroup(
  segments: ThinkingTurnSegment[],
  thinkingItems: ThinkingTimelineItem[],
): void {
  const targetIndex = findLastToolGroupWithToolsIndex(segments);
  if (targetIndex < 0) return;
  const target = segments[targetIndex];
  if (target?.kind !== 'tool-group') return;

  const merged = [...target.timeline];
  for (const item of thinkingItems) {
    if (item.type !== 'thinking') continue;
    const redundant = merged.some(
      (existing) =>
        existing.type === 'thinking'
        && isRedundantThinking(existing.content, item.content),
    );
    if (!redundant) merged.push(item);
  }
  if (merged.length === target.timeline.length) return;
  segments[targetIndex] = {
    ...target,
    timeline: rebalanceThinkingTimelineForDisplay(merged),
  };
}

/**
 * 正文已外置且已有 tool 摘要时，末尾 thinking-only 组不应再拆出第二个「思考 N 次」
 * （无短 text 截断时不应出现第二组一级摘要）。
 */
function collapseRedundantTrailingThinkingOnlyGroup(
  segments: ThinkingTurnSegment[],
  finalReplyText: string | null,
): void {
  if (!finalReplyText?.trim() || segments.length === 0) return;

  const lastIndex = segments.length - 1;
  const last = segments[lastIndex];
  if (last?.kind !== 'tool-group' || groupHasTool(last.timeline)) return;
  if (findLastToolGroupWithToolsIndex(segments.slice(0, lastIndex)) < 0) return;

  mergeThinkingTimelineIntoLastToolGroup(segments, last.timeline);
  segments.pop();
}

/** 展示层：去掉末尾多余的 thinking-only 一级摘要（与 collapse 规则一致） */
export function trimTrailingThinkingOnlyToolGroupSegments(
  segments: ThinkingTurnSegment[],
): ThinkingTurnSegment[] {
  if (segments.length < 2) return segments;
  const last = segments[segments.length - 1];
  if (last?.kind !== 'tool-group' || groupHasTool(last.timeline)) return segments;
  if (findLastToolGroupWithToolsIndex(segments.slice(0, -1)) < 0) return segments;
  return segments.slice(0, -1);
}

/**
 * 按 content 顺序 + 短 text 分段解析思考过程布局。
 * 对齐四张天气示例：text ↔ 一级摘要交替，最终 text 单独作为正文。
 */
export function parseThinkingTurnLayout(
  messages: RawMessage[],
  options: ParseThinkingTurnLayoutOptions,
): ParsedThinkingTurn {
  const picked = pickTimelineSourceMessages(messages);
  if (picked.length === 0) {
    return { segments: [], finalReplyText: null };
  }

  const engineProfile = resolveEngineProfile(picked, options.engineProfile);

  // 必须合并全部 picked snapshot：最后一条常为纯 text，只读它会丢光 thinking/tool
  const pickedFromMessages = mergeEventsFromPickedMessages(picked);
  let mergedEvents =
    (options.chronologicalEntries?.length ?? 0) > 0
      ? mergeEventsFromChronologicalTurn(picked, options.chronologicalEntries!)
      : pickedFromMessages;
  // chronological 与 picked 引用不一致时可能漏事件；回退 picked 合并保批次间旁白
  if (
    (options.chronologicalEntries?.length ?? 0) > 0
    && mergedEvents.length === 0
    && pickedFromMessages.length > 0
  ) {
    mergedEvents = pickedFromMessages;
  }
  const segments: ThinkingTurnSegment[] = [];
  let currentGroup: ThinkingTimelineItem[] = [];
  let groupIndex = 0;
  let hasSeenToolInTurn = false;
  let openingText: string | null = null;
  const pendingPreBatchTexts: string[] = [];
  let candidateFinalReply: string | null = null;
  const lastTextEventIndex = findLastTextEventIndex(mergedEvents);
  const streamingTools = options.streamingTools ?? [];
  const hasToolEventsInMerged = mergedEvents.some((event) => event.type === 'tool');
  const streamingToolsActive =
    options.isLiveStream
    && streamingTools.length > 0
    && (engineProfile.useStreamingToolSupplement || !hasToolEventsInMerged);
  const seenToolKeys = new Set<string>();

  for (let eventIndex = 0; eventIndex < mergedEvents.length; eventIndex += 1) {
    const event = mergedEvents[eventIndex]!;
    if (event.type === 'text') {
      const trimmed = event.text.trim();
      if (!trimmed || isClaudeRuntimeControlText(trimmed)) continue;
      const toolsKnownInTurn = hasSeenToolInTurn;
      const promoteAsFinal = shouldPromoteTextToFinalReply(
        trimmed,
        options.isLiveStream,
        eventIndex,
        lastTextEventIndex,
        hasToolEventsAfter(mergedEvents, eventIndex),
      );
      // OpenClaw 常 echo 用户原问；整条跳过，避免顶部多出与气泡重复的 phase-text
      if (isEchoOfUserQuery(trimmed, options.precedingUserText)) {
        continue;
      }

      // thinking 已开始、尚无 tool：长/markdown → 正文；短 text → 入队，等 tool 批次间插入
      if (
        turnHasThinkingContent(segments, currentGroup)
        && !groupHasTool(currentGroup)
        && !toolsKnownInTurn
      ) {
        if (promoteAsFinal) {
          candidateFinalReply = mergeFinalReplyCandidate(candidateFinalReply, trimmed);
          continue;
        }
        if (isLikelyDeliverableReply(trimmed) && options.isLiveStream) {
          continue;
        }
        // thinking 已开始后，开场白延长仍写回顶部 opening，避免顶部卡住旧文案、下方又冒一段
        if (
          openingText !== null
          && (trimmed.startsWith(openingText) || openingText.startsWith(trimmed))
        ) {
          const nextOpening: string =
            trimmed.length >= openingText.length ? trimmed : openingText;
          openingText = nextOpening;
          if (engineProfile.name !== 'claude') {
            replaceOpeningPhaseTextSegment(segments, nextOpening);
          }
          continue;
        }
        if (!pendingPreBatchTexts.includes(trimmed)) {
          pendingPreBatchTexts.push(trimmed);
        }
        continue;
      }

      // 图二：一批 tool 已跑完 + 新 text → flush 成独立 phase-text
      // Claude 多 snapshot 合并后事件流与 OpenClaw 单 snapshot 等价，不能只靠消息边界
      const shouldFlushBatchInterruptText =
        groupHasTool(currentGroup)
        && (
          engineProfile.flushOnIntraSnapshotText
          || engineProfile.name === 'claude'
        );
      if (shouldFlushBatchInterruptText) {
        const completedAt = groupIndex;
        currentGroup = flushCompletedToolGroup(currentGroup, segments, groupIndex);
        groupIndex += 1;
        if (promoteAsFinal) {
          candidateFinalReply = mergeFinalReplyCandidate(candidateFinalReply, trimmed);
        } else if (isLikelyDeliverableReply(trimmed) && options.isLiveStream) {
          continue;
        } else {
          upsertPhaseTextSegment(segments, event.text, `phase-text-after-${completedAt}`);
        }
        continue;
      }

      if (!toolsKnownInTurn && !turnHasThinkingContent(segments, currentGroup)) {
        if (promoteAsFinal) {
          candidateFinalReply = mergeFinalReplyCandidate(candidateFinalReply, trimmed);
          continue;
        }
        if (isLikelyDeliverableReply(trimmed) && options.isLiveStream) {
          continue;
        }
        openingText =
          engineProfile.name === 'claude'
            ? trackClaudeDeferredOpeningText(event.text, openingText, pendingPreBatchTexts)
            : handlePreBatchText(segments, event.text, openingText, pendingPreBatchTexts);
        continue;
      }

      // 批次间 narration：上一批 tool 已 flush、下一批尚未进 currentGroup → 顺序追加
      // 不用 pending（会在回合末堆到底部）；也不靠 state==='active'（循环结束后才标记）
      if (toolsKnownInTurn && !groupHasTool(currentGroup)) {
        if (promoteAsFinal) {
          candidateFinalReply = mergeFinalReplyCandidate(candidateFinalReply, trimmed);
        } else if (isLikelyDeliverableReply(trimmed) && options.isLiveStream) {
          continue;
        } else {
          upsertPhaseTextSegment(segments, event.text, midPhaseTextKey(segments));
        }
        continue;
      }

      if (promoteAsFinal) {
        candidateFinalReply = mergeFinalReplyCandidate(candidateFinalReply, trimmed);
      } else if (isLikelyDeliverableReply(trimmed) && options.isLiveStream) {
        continue;
      } else {
        upsertPhaseTextSegment(segments, event.text, midPhaseTextKey(segments));
      }
      continue;
    }

    if (event.type === 'thinking') {
      candidateFinalReply = reclaimLeadingDeliverablePhaseText(segments, candidateFinalReply);
      currentGroup = appendThinkingToGroup(currentGroup, event.content, event.liveParts);
      continue;
    }

    if (!hasSeenToolInTurn) {
      hasSeenToolInTurn = true;
    }

    // opening-only：首批 tool 前不交错；已有 tool 的组再进 tool 时仍插入 pending 旁白（单 snapshot 内图二）
    const shouldInterleavePending =
      engineProfile.preBatchTextStrategy === 'interleave'
      || (pendingPreBatchTexts.length > 0 && groupHasTool(currentGroup));
    const interleaved = shouldInterleavePending
      ? interleavePendingTextBeforeNextToolGroup(
        segments,
        pendingPreBatchTexts,
        currentGroup,
        groupIndex,
      )
      : { currentGroup, groupIndex };
    currentGroup = interleaved.currentGroup;
    groupIndex = interleaved.groupIndex;
    currentGroup = appendToolToGroup(currentGroup, event);
    seenToolKeys.add(thinkingTimelineToolKey(event));
    if (isStableToolId(event.id, event.name)) {
      seenToolKeys.add(`stable-name::${event.name}`);
    }
  }

  const supplemental = streamingToolsActive
    ? appendSupplementalStreamingTools(
      segments,
      pendingPreBatchTexts,
      currentGroup,
      groupIndex,
      streamingTools,
      seenToolKeys,
      engineProfile,
    )
    : { currentGroup, groupIndex };
  currentGroup = supplemental.currentGroup;
  groupIndex = supplemental.groupIndex;

  // 回合结束前：pre-batch 旁白若仍挂着无 tool 的 currentGroup 上，落成 narration 折进 timeline
  flushPendingIntoAdjacentGroupGaps(segments, pendingPreBatchTexts);
  if (
    pendingPreBatchTexts.length > 0
    && !groupHasTool(currentGroup)
    && engineProfile.name !== 'claude'
  ) {
    while (pendingPreBatchTexts.length > 0) {
      const phaseText = pendingPreBatchTexts.shift();
      if (phaseText) {
        upsertPhaseTextSegment(segments, phaseText, midPhaseTextKey(segments));
      }
    }
  }

  if (currentGroup.length > 0) {
    // streaming tool 已进 currentGroup 但 pending 旁白还没插入时，先落旁白再 push 摘要组
    const isFirstToolGroup = !segments.some((segment) => segment.kind === 'tool-group');
    if (
      groupHasTool(currentGroup)
      && pendingPreBatchTexts.length > 0
      && !(engineProfile.name === 'claude' && isFirstToolGroup)
    ) {
      while (pendingPreBatchTexts.length > 0) {
        const phaseText = pendingPreBatchTexts.shift();
        if (phaseText) {
          upsertPhaseTextSegment(segments, phaseText, midPhaseTextKey(segments));
        }
      }
    }
    segments.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(currentGroup, groupIndex),
      timeline: currentGroup,
      state: options.isLiveStream ? 'active' : 'completed',
    });
  } else if (streamingToolsActive) {
    const emptySupplemental = appendSupplementalStreamingTools(
      segments,
      pendingPreBatchTexts,
      [],
      groupIndex,
      streamingTools,
      seenToolKeys,
      engineProfile,
    );
    if (emptySupplemental.currentGroup.length > 0) {
      segments.push({
        kind: 'tool-group',
        key: toolGroupSegmentKey(emptySupplemental.currentGroup, emptySupplemental.groupIndex),
        timeline: emptySupplemental.currentGroup,
        state: options.isLiveStream ? 'active' : 'completed',
      });
    }
  }

  enrichSegmentsWithStreamingInputs(segments, streamingTools.length > 0 ? streamingTools : undefined);

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment?.kind !== 'tool-group') continue;
    segments[i] = {
      ...segment,
      timeline: rebalanceThinkingTimelineForDisplay(segment.timeline),
    };
  }

  reconcileAdjacentToolGroupsFromEvents(
    segments,
    mergedEvents,
    lastTextEventIndex,
    options.isLiveStream,
    options.precedingUserText,
  );

  // deferred opening / pre-batch 旁白落 segment（OpenClaw + Claude）；完成态 normalize 才能切分
  ensureDeferredPhaseTextsBelowFirstToolGroup(
    segments,
    openingText,
    pendingPreBatchTexts,
  );

  const finalReplyText = finalizeReplyText(segments, candidateFinalReply);
  dedupePhaseTextsAgainstFinalReply(segments, finalReplyText);

  // live：堆叠旁白 / 单组多 tool 按时间 zip 成图二交替（OpenClaw 流式常见）
  if (options.isLiveStream) {
    splitStackedPhaseTextsIntoFigureTwoLayout(
      segments,
      mergedEvents,
      lastTextEventIndex,
      options.precedingUserText,
      true,
    );
    // live + history 共用 normalize：mergedEvents 已含 text↔tool 交错时才实时拆段
    const hasInterleavedEventSources =
      mergedEvents.some((event) => event.type === 'tool')
      && mergedEvents.some((event) => event.type === 'text');
    if (
      hasInterleavedEventSources
      && !shouldSkipDoneSegmentNormalize(segments, mergedEvents, lastTextEventIndex)
      && !isChronologicallyOrderedLayout(segments)
    ) {
      normalizeDoneThinkingSegments(
        segments,
        mergedEvents,
        lastTextEventIndex,
        options.precedingUserText,
      );
    }
  }

  // live 顺序由事件交错 + batch flush 决定；完成态才做堆叠旁白的一次性整理
  if (!options.isLiveStream) {
    normalizeDoneThinkingSegments(
      segments,
      mergedEvents,
      lastTextEventIndex,
      options.precedingUserText,
    );
  }

  // normalize 可能把 opening 又排到摘要上；再校正 deferred 旁白位置
  ensureDeferredPhaseTextsBelowFirstToolGroup(
    segments,
    openingText,
    pendingPreBatchTexts,
  );

  if (options.isLiveStream) {
    markToolGroupStreamStates(segments);
  } else {
    for (const segment of segments) {
      if (segment.kind === 'tool-group') {
        segment.state = 'completed';
      }
    }
  }

  dedupePhaseTextsEchoingUserQuery(segments, options.precedingUserText);

  // Claude 完成态：loadHistory / normalize 可能清掉 tool，最后用 streamingTools 兜底补回
  if (!options.isLiveStream && engineProfile.name === 'claude' && streamingTools.length > 0) {
    ensureClaudeDoneSegmentsIncludeStreamingTools(segments, streamingTools);
  }

  collapseRedundantTrailingThinkingOnlyGroup(segments, finalReplyText);

  relocateInterruptPhaseBetweenAdjacentToolGroups(segments);
  mergeAdjacentOrphanedThinkingAndToolGroups(segments);

  // normalize 可能重新生成 phase-text；澄清正文优先需再扫一遍同类 phase
  dedupePhaseTextsAgainstFinalReply(segments, finalReplyText);

  const layout: ParsedThinkingTurn = { segments, finalReplyText };
  let parts = reduceTurnParts(mergedEvents, {
    isLiveStream: options.isLiveStream,
    streamingTools: options.streamingTools,
  });
  if (options.wasInterrupted) {
    parts = appendInterruptedPart(parts);
  }
  return applyTextOwnershipToParsedTurn(
    applyTurnPartsToParsedTurn(layout, parts, {
      wasInterrupted: options.wasInterrupted,
    }),
    { isLiveStream: options.isLiveStream },
  );
}

interface ParseThinkingTurnLayoutCacheEntry {
  messages: RawMessage[];
  fingerprints: string[];
  options: ParseThinkingTurnLayoutOptions;
  result: ParsedThinkingTurn;
}

/** 每 turn 一条最近结果；活跃流式 turn 之外基本不增长，小上限防泄漏 */
const PARSE_LAYOUT_CACHE_LIMIT = 8;
const parseLayoutCache = new Map<string, ParseThinkingTurnLayoutCacheEntry>();

function parseLayoutInputsEqual(
  entry: ParseThinkingTurnLayoutCacheEntry,
  messages: RawMessage[],
  options: ParseThinkingTurnLayoutOptions,
): boolean {
  const cachedOptions = entry.options;
  if (
    cachedOptions.isLiveStream !== options.isLiveStream
    || cachedOptions.streamingTools !== options.streamingTools
    || cachedOptions.chronologicalEntries !== options.chronologicalEntries
    || cachedOptions.precedingUserText !== options.precedingUserText
    || cachedOptions.engineProfile !== options.engineProfile
    || cachedOptions.wasInterrupted !== options.wasInterrupted
  ) {
    return false;
  }
  if (entry.messages.length !== messages.length) return false;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || entry.messages[index] !== message) return false;
    if (entry.fingerprints[index] !== messageContentCacheFingerprint(message)) return false;
  }
  return true;
}

/**
 * parseThinkingTurnLayout 的结果复用缓存（保守版增量：只做「输入完全未变 → 复用」，
 * 不做有正确性风险的尾部增量解析；parser 是纯函数，引用相等即输出相等）。
 *
 * 覆盖场景：activeStream 包装对象每渲染新建导致的 useMemo 失效重渲染
 * （staleTick、无关 store 更新等），命中时返回同一 result 引用，
 * 下游 useMemo / memo 链全部保持。cacheKey 缺省时直出不缓存。
 */
export function parseThinkingTurnLayoutCached(
  cacheKey: string | undefined,
  messages: RawMessage[],
  options: ParseThinkingTurnLayoutOptions,
): ParsedThinkingTurn {
  if (!cacheKey) return parseThinkingTurnLayout(messages, options);

  const cached = parseLayoutCache.get(cacheKey);
  if (cached && parseLayoutInputsEqual(cached, messages, options)) {
    return cached.result;
  }

  const result = parseThinkingTurnLayout(messages, options);
  parseLayoutCache.delete(cacheKey);
  parseLayoutCache.set(cacheKey, {
    messages,
    fingerprints: messages.map(messageContentCacheFingerprint),
    options,
    result,
  });
  if (parseLayoutCache.size > PARSE_LAYOUT_CACHE_LIMIT) {
    const oldest = parseLayoutCache.keys().next().value;
    if (oldest !== undefined) parseLayoutCache.delete(oldest);
  }
  return result;
}

function countToolsInSegments(segments: ThinkingTurnSegment[]): number {
  return segments
    .filter((segment) => segment.kind === 'tool-group')
    .reduce(
      (count, group) => count + group.timeline.filter((item) => item.type === 'tool').length,
      0,
    );
}

/** Claude done：segments 里缺 tool 时，用 streamingTools / tool_result 合成结果强制补全 */
function ensureClaudeDoneSegmentsIncludeStreamingTools(
  segments: ThinkingTurnSegment[],
  streamingTools: ParseThinkingTurnStreamingTool[],
): void {
  if (streamingTools.length === 0) return;

  const seenKeys = new Set<string>();
  for (const segment of segments) {
    if (segment.kind !== 'tool-group') continue;
    for (const item of segment.timeline) {
      if (item.type === 'tool') {
        seenKeys.add(thinkingTimelineToolKey(item));
      }
    }
  }

  let pendingGroup: ThinkingTimelineItem[] = [];
  for (const tool of streamingTools) {
    if (!shouldAppendStreamingExtraTool(tool)) continue;

    const id = resolveStreamingToolId(tool);
    const candidate = { id, name: tool.name, input: tool.input ?? null };
    const key = thinkingTimelineToolKey(candidate);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    pendingGroup = appendToolToGroup(pendingGroup, candidate);
  }

  if (pendingGroup.length === 0) return;

  if (countToolsInSegments(segments) === 0) {
    const thinkingOnlyIndex = findLastThinkingOnlyToolGroupIndex(segments);
    const phaseAfterThinkingOnly =
      thinkingOnlyIndex >= 0
      && segments[thinkingOnlyIndex + 1]?.kind === 'phase-text';
    // 无批次间旁白时并入 thinking-only 组，避免「思考 N 次」与「使用 N 个工具」空档（Claude loadHistory 丢 tool_use）
    if (thinkingOnlyIndex >= 0 && !phaseAfterThinkingOnly) {
      const group = segments[thinkingOnlyIndex];
      if (group?.kind === 'tool-group') {
        segments[thinkingOnlyIndex] = {
          ...group,
          timeline: rebalanceThinkingTimelineForDisplay([
            ...group.timeline,
            ...pendingGroup,
          ]),
        };
        return;
      }
    }

    const groupIndex = segments.filter((segment) => segment.kind === 'tool-group').length;
    segments.push({
      kind: 'tool-group',
      key: toolGroupSegmentKey(pendingGroup, groupIndex),
      timeline: rebalanceThinkingTimelineForDisplay(pendingGroup),
      state: 'completed',
    });
    return;
  }

  let lastGroupIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.kind === 'tool-group') {
      lastGroupIndex = index;
      break;
    }
  }
  if (lastGroupIndex < 0) return;
  const lastGroup = segments[lastGroupIndex];
  if (lastGroup?.kind !== 'tool-group') return;
  segments[lastGroupIndex] = {
    ...lastGroup,
    timeline: rebalanceThinkingTimelineForDisplay([
      ...lastGroup.timeline,
      ...pendingGroup,
    ]),
  };
}

export function buildThinkingGroupSummaryLabel(
  timeline: ThinkingTimelineItem[],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const toolCount = timeline.filter((item) => item.type === 'tool').length;
  const thoughtCount = timeline.filter((item) => item.type === 'thinking').length;
  if (toolCount === 0 && thoughtCount === 0) return null;
  if (thoughtCount === 0) {
    return t('streaming.collapsedSummaryToolsOnly', { toolCount });
  }
  if (toolCount === 0) {
    return t('streaming.collapsedSummaryThoughtsOnly', { thoughtCount });
  }
  return t('streaming.collapsedSummary', { thoughtCount, toolCount });
}
