/**
 * batch-segments — 思考过程批次 segment 的增删与流式 state 标记
 *
 * 规则（与 docs/thinking-process-interaction.md 一致）：
 * - 短 text 打断 → flush 当前 tool-group 为 completed，再 append phase-text
 * - live 时仅最后一个 tool-group 为 active
 * - 其后若是 Claude deferred opening（OPENING_PHASE_TEXT_KEY）→ 首批仍在进行，保持 active
 * - 其后若是批次间旁白（图二打断）→ 该批 completed
 */
import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import type { ThinkingTurnSegment } from '@/pages/Chat/thinking/types';
import { OPENING_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';

export function completedToolGroupCount(segments: ThinkingTurnSegment[]): number {
  return segments.filter((segment) => segment.kind === 'tool-group').length;
}

export function midPhaseTextKey(segments: ThinkingTurnSegment[]): string {
  const afterCount = completedToolGroupCount(segments);
  const midSeq = segments.filter(
    (segment) =>
      segment.kind === 'phase-text'
      && segment.key.startsWith(`phase-text-after-${afterCount}-mid-`),
  ).length;
  return `phase-text-after-${afterCount}-mid-${midSeq}`;
}

export function groupHasTool(group: ThinkingTimelineItem[]): boolean {
  return group.some((item) => item.type === 'tool');
}

/** 批次 segment key：按批次序号固定，避免流式中 tool id 到达后 React remount 重播 */
export function toolGroupSegmentKey(_timeline: ThinkingTimelineItem[], groupIndex: number): string {
  return `tool-group-batch-${groupIndex}`;
}

/**
 * 将含 tool 的 currentGroup flush 为 completed 一级摘要；无 tool 则丢弃（仅思考、尚未调工具）。
 */
export function flushCompletedToolGroup(
  group: ThinkingTimelineItem[],
  segments: ThinkingTurnSegment[],
  groupIndex: number,
): ThinkingTimelineItem[] {
  if (group.length === 0) return group;
  if (!groupHasTool(group)) return [];

  segments.push({
    kind: 'tool-group',
    key: toolGroupSegmentKey(group, groupIndex),
    timeline: group,
    state: 'completed',
  });
  return [];
}

export function upsertPhaseTextSegment(
  segments: ThinkingTurnSegment[],
  text: string,
  stableKey: string,
): void {
  const trimmed = text.trim();
  if (!trimmed) return;

  const existingIndex = segments.findIndex(
    (segment) => segment.kind === 'phase-text' && segment.key === stableKey,
  );
  if (existingIndex >= 0) {
    const existing = segments[existingIndex];
    if (existing?.kind !== 'phase-text') return;
    if (existing.text === trimmed) return;
    if (trimmed.startsWith(existing.text) || existing.text.startsWith(trimmed)) {
      segments[existingIndex] = {
        ...existing,
        text: trimmed.length >= existing.text.length ? trimmed : existing.text,
      };
      return;
    }
    segments.push({
      kind: 'phase-text',
      key: `${stableKey}-seq-${segments.length}`,
      text: trimmed,
    });
    return;
  }

  const last = segments[segments.length - 1];
  if (last?.kind === 'phase-text') {
    if (last.text === trimmed) return;
    if (trimmed.startsWith(last.text) || last.text.startsWith(trimmed)) {
      segments[segments.length - 1] = {
        ...last,
        text: trimmed.length >= last.text.length ? trimmed : last.text,
      };
      return;
    }
  }

  segments.push({
    kind: 'phase-text',
    key: stableKey,
    text: trimmed,
  });
}

export function replaceOpeningPhaseTextSegment(
  segments: ThinkingTurnSegment[],
  text: string,
): void {
  upsertPhaseTextSegment(segments, text, OPENING_PHASE_TEXT_KEY);
}

/** 流式：判定当前仍 active 的 tool-group 下标（无则 -1） */
function findActiveToolGroupIndex(segments: ThinkingTurnSegment[]): number {
  let lastGroupIndex = -1;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.kind === 'tool-group') {
      lastGroupIndex = index;
      break;
    }
  }
  if (lastGroupIndex < 0) return -1;

  const trailing = segments.slice(lastGroupIndex + 1);
  if (trailing.length === 0) return lastGroupIndex;

  // Claude：opening 落在首个摘要下方，但 tool 仍在追加 → 不算批次结束
  const onlyDeferredOpening = trailing.every(
    (segment) =>
      segment.kind === 'phase-text' && segment.key === OPENING_PHASE_TEXT_KEY,
  );
  if (onlyDeferredOpening) return lastGroupIndex;

  return -1;
}

/** 流式：仅末段 active tool-group 标 active；完成态全部由调用方设为 completed */
export function markToolGroupStreamStates(segments: ThinkingTurnSegment[]): void {
  const activeGroupIndex = findActiveToolGroupIndex(segments);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment?.kind !== 'tool-group') continue;
    segment.state = index === activeGroupIndex ? 'active' : 'completed';
  }
}
