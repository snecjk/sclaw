/**
 * TurnPart → ThinkingTurnSegment adapter（Phase 2 / 5）
 *
 * 在 parseThinkingTurnLayout 结果上补全 tool input、按 identity 去重，
 * 不重新排序 segment 结构（Phase 4：done fallback 只补缺口）。
 */
import {
  isConflictingToolInput,
  mergeToolInput,
  resolveToolInputState,
  thinkingTimelineToolIdentityKey,
} from '@/lib/tool-input-merge';
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import { buildToolPartLookup } from '@/pages/Chat/thinking/turn-part-reducer';
import type { TurnPart } from '@/pages/Chat/thinking/turn-parts';
import type {
  ParsedThinkingTurn,
  ThinkingTurnSegment,
} from '@/pages/Chat/thinking/types';
import { INTERRUPTED_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';

function enrichToolItem(
  item: Extract<ThinkingTimelineItem, { type: 'tool' }>,
  toolLookup: ReturnType<typeof buildToolPartLookup>,
): Extract<ThinkingTimelineItem, { type: 'tool' }> {
  const identityKey = thinkingTimelineToolIdentityKey({
    id: item.id,
    name: item.name,
  });
  const fromPart =
    toolLookup.get(identityKey)
    ?? toolLookup.get(item.id)
    ?? toolLookup.get(item.name);
  // timeline 自己的 input 优先；lookup 只补缺口，不得反向覆盖（否则同名多次调用会被抹平）。
  const mergedInput = mergeToolInput(fromPart?.input, item.input);
  return { ...item, input: mergedInput };
}

type TimelineTool = Extract<ThinkingTimelineItem, { type: 'tool' }>;

/**
 * 同一 identity 的工具只保留首次出现，input 取合并后最高质量。
 *
 * identity 撞车时按 input 冲突切开：id 唯一性不可信（弱 id `name === id`，以及
 * 网关适配出来的 `toolu_<Name>_0` —— 一轮里 24 条不同命令共用同一个 id），
 * 一律合并会让工具列表整段丢调用。input 兼容（含流式空 → 补全）仍然合并。
 */
function dedupeTimelineTools(
  timeline: ThinkingTimelineItem[],
  toolLookup: ReturnType<typeof buildToolPartLookup>,
): ThinkingTimelineItem[] {
  const mergedByKey = new Map<string, TimelineTool>();
  const resultIndexByKey = new Map<string, number>();
  /** base identity → 当前正在累积的那次调用的 key */
  const activeKeyByBase = new Map<string, string>();
  const collisionCountByBase = new Map<string, number>();

  const resolveKey = (tool: TimelineTool): string => {
    const baseKey = thinkingTimelineToolIdentityKey({ id: tool.id, name: tool.name });
    const activeKey = activeKeyByBase.get(baseKey) ?? baseKey;
    const active = mergedByKey.get(activeKey);
    if (!active || !isConflictingToolInput(active.input, tool.input)) return activeKey;

    const nextCall = (collisionCountByBase.get(baseKey) ?? 0) + 1;
    collisionCountByBase.set(baseKey, nextCall);
    const splitKey = `${baseKey}::call-${nextCall}`;
    activeKeyByBase.set(baseKey, splitKey);
    return splitKey;
  };

  const result: ThinkingTimelineItem[] = [];

  for (const item of timeline) {
    if (item.type !== 'tool') {
      result.push(item);
      continue;
    }

    const enriched = enrichToolItem(item, toolLookup);
    const key = resolveKey(enriched);
    const existing = mergedByKey.get(key);

    if (existing) {
      const merged = { ...existing, input: mergeToolInput(existing.input, enriched.input) };
      mergedByKey.set(key, merged);
      const index = resultIndexByKey.get(key);
      if (index !== undefined) result[index] = merged;
      continue;
    }

    mergedByKey.set(key, enriched);
    resultIndexByKey.set(key, result.length);
    result.push(enriched);
  }

  return result;
}

function enrichSegments(
  segments: ThinkingTurnSegment[],
  toolLookup: ReturnType<typeof buildToolPartLookup>,
): ThinkingTurnSegment[] {
  return segments.map((segment) => {
    if (segment.kind !== 'tool-group') return segment;
    return {
      ...segment,
      timeline: dedupeTimelineTools(segment.timeline, toolLookup),
    };
  });
}

/** 在 segments 末尾追加 interrupted 系统 phase（Phase 6） */
export function appendInterruptedPhaseSegment(
  segments: ThinkingTurnSegment[],
): ThinkingTurnSegment[] {
  if (segments.some(
    (segment) => segment.kind === 'phase-text' && segment.key === INTERRUPTED_PHASE_TEXT_KEY,
  )) {
    return segments;
  }
  return [
    ...segments,
    {
      kind: 'phase-text',
      key: INTERRUPTED_PHASE_TEXT_KEY,
      text: '',
    },
  ];
}

export function applyTurnPartsToParsedTurn(
  layout: ParsedThinkingTurn,
  parts: TurnPart[],
  options?: { wasInterrupted?: boolean },
): ParsedThinkingTurn {
  const toolLookup = buildToolPartLookup(parts);
  let segments = enrichSegments(layout.segments, toolLookup);

  const hasInterruptedPart = parts.some((part) => part.kind === 'interrupted');
  if (options?.wasInterrupted || hasInterruptedPart) {
    segments = appendInterruptedPhaseSegment(segments);
  }

  return {
    segments,
    finalReplyText: layout.finalReplyText,
  };
}

/** 供 ChatToolCallCard：从 TurnPart lookup 解析 inputState */
export function resolveTimelineToolInputState(
  item: Extract<ThinkingTimelineItem, { type: 'tool' }>,
  toolLookup: ReturnType<typeof buildToolPartLookup>,
  status?: 'running' | 'completed' | 'error',
): ReturnType<typeof resolveToolInputState> {
  const identityKey = thinkingTimelineToolIdentityKey({
    id: item.id,
    name: item.name,
  });
  const fromPart =
    toolLookup.get(identityKey)
    ?? toolLookup.get(item.id)
    ?? toolLookup.get(item.name);
  if (fromPart) return fromPart.inputState;
  return resolveToolInputState(item.input, status ?? 'completed');
}
