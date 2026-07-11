/**
 * TurnPart → ThinkingTurnSegment adapter（Phase 2 / 5）
 *
 * 在 parseThinkingTurnLayout 结果上补全 tool input、按 identity 去重，
 * 不重新排序 segment 结构（Phase 4：done fallback 只补缺口）。
 */
import {
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
  const mergedInput = mergeToolInput(item.input, fromPart?.input);
  return { ...item, input: mergedInput };
}

/** 同一 identity 的工具只保留首次出现，input 取合并后最高质量 */
function dedupeTimelineTools(
  timeline: ThinkingTimelineItem[],
  toolLookup: ReturnType<typeof buildToolPartLookup>,
): ThinkingTimelineItem[] {
  const seenIdentities = new Set<string>();
  const mergedByIdentity = new Map<
    string,
    Extract<ThinkingTimelineItem, { type: 'tool' }>
  >();

  const result: ThinkingTimelineItem[] = [];

  for (const item of timeline) {
    if (item.type !== 'tool') {
      result.push(item);
      continue;
    }

    const enriched = enrichToolItem(item, toolLookup);
    const identityKey = thinkingTimelineToolIdentityKey({
      id: enriched.id,
      name: enriched.name,
    });

    const existing = mergedByIdentity.get(identityKey);
    if (existing) {
      mergedByIdentity.set(identityKey, {
        ...existing,
        input: mergeToolInput(existing.input, enriched.input),
      });
      const idx = result.findIndex(
        (entry) =>
          entry.type === 'tool'
          && thinkingTimelineToolIdentityKey(entry) === identityKey,
      );
      if (idx >= 0) {
        result[idx] = mergedByIdentity.get(identityKey)!;
      }
      continue;
    }

    seenIdentities.add(identityKey);
    mergedByIdentity.set(identityKey, enriched);
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
