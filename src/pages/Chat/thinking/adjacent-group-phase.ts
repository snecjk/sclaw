import type { ThinkingTimelineItem, ThinkingTurnSegment } from '@/pages/Chat/thinking/types';
import { OPENING_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';
import { groupHasTool } from '@/pages/Chat/thinking/batch-segments';

function thinkingTimelineToolKey(tool: { id: string; name: string; input: unknown }): string {
  const inputKey =
    tool.input === null || tool.input === undefined
      ? ''
      : typeof tool.input === 'string'
        ? tool.input
        : JSON.stringify(tool.input);
  return `${tool.name}::${tool.id}::${inputKey}`;
}

function hasAdjacentToolGroupsWithoutPhase(segments: ThinkingTurnSegment[]): boolean {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.kind !== 'tool-group') continue;
    if (segments[index + 1]?.kind !== 'tool-group') continue;
    return true;
  }
  return false;
}

/**
 * [摘要1][摘要2][旁白] → [摘要1][旁白][摘要2]
 * 图二：批次间短旁白必须夹在相邻一级摘要之间，不能堆在末尾。
 */
export function relocateInterruptPhaseBetweenAdjacentToolGroups(
  segments: ThinkingTurnSegment[],
): void {
  if (!hasAdjacentToolGroupsWithoutPhase(segments)) return;

  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index]?.kind !== 'tool-group') continue;
    if (segments[index + 1]?.kind !== 'tool-group') continue;

    for (let phaseIndex = index + 2; phaseIndex < segments.length; phaseIndex += 1) {
      const candidate = segments[phaseIndex];
      if (candidate?.kind !== 'phase-text') break;
      if (candidate.key === OPENING_PHASE_TEXT_KEY) continue;

      segments.splice(phaseIndex, 1);
      segments.splice(index + 1, 0, candidate);
      return;
    }
  }
}

/**
 * [思考-only 摘要][工具-only 摘要] 且无旁白 → 合并为单组
 * Claude 完成态 loadHistory 丢 tool_use、工具仅从 streamingTools 补回时常见。
 */
export function mergeAdjacentOrphanedThinkingAndToolGroups(
  segments: ThinkingTurnSegment[],
): void {
  for (let index = 0; index < segments.length - 1; index += 1) {
    const left = segments[index];
    const right = segments[index + 1];
    if (left?.kind !== 'tool-group' || right?.kind !== 'tool-group') continue;

    const leftThinkingOnly =
      !groupHasTool(left.timeline)
      && left.timeline.some((item) => item.type === 'thinking');
    const rightToolsOnly =
      groupHasTool(right.timeline)
      && !right.timeline.some((item) => item.type === 'thinking');
    if (!leftThinkingOnly || !rightToolsOnly) continue;

    segments[index] = {
      ...left,
      timeline: mergeThinkingAndToolTimelines(left.timeline, right.timeline),
    };
    segments.splice(index + 1, 1);
    return;
  }
}

function mergeThinkingAndToolTimelines(
  left: ThinkingTimelineItem[],
  right: ThinkingTimelineItem[],
): ThinkingTimelineItem[] {
  const thinkings = left.filter((item) => item.type === 'thinking');
  const tools = right.filter((item) => item.type === 'tool');
  const merged: ThinkingTimelineItem[] = [...thinkings];
  for (const tool of tools) {
    merged.push(tool);
  }
  return merged;
}

/**
 * 去掉工具已在更早摘要中出现过的冗余组（流式缓存与 done 解析 tool id 不一致时按 name 去重）。
 */
export function pruneDuplicateToolOnlyGroups(segments: ThinkingTurnSegment[]): void {
  const seenToolKeys = new Set<string>();
  const seenToolNames = new Set<string>();

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment?.kind !== 'tool-group') continue;

    const tools = segment.timeline.filter((item) => item.type === 'tool');
    if (tools.length === 0) continue;

    const toolsOnly = !segment.timeline.some((item) => item.type === 'thinking');
    const duplicateOnly =
      tools.every((tool) => seenToolKeys.has(thinkingTimelineToolKey(tool)))
      || (toolsOnly && tools.every((tool) => seenToolNames.has(tool.name)));
    if (duplicateOnly) {
      segments.splice(index, 1);
      index -= 1;
      continue;
    }

    for (const tool of tools) {
      seenToolKeys.add(thinkingTimelineToolKey(tool));
      seenToolNames.add(tool.name);
    }
  }
}
