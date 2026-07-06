import type { RawTurnEvent, ThinkingTurnSegment } from '@/pages/Chat/thinking/types';
import {
  classifyTextOverlap,
  normalizeDisplayTextForOwnership,
} from '@/pages/Chat/thinking/text-ownership';

function groupHasTool(
  group: { type: string }[],
): boolean {
  return group.some((item) => item.type === 'tool');
}

function turnHasToolGroups(segments: ThinkingTurnSegment[]): boolean {
  return segments.some(
    (segment) => segment.kind === 'tool-group' && groupHasTool(segment.timeline),
  );
}

function turnHasThinkingContent(
  segments: ThinkingTurnSegment[],
  currentGroup: { type: string }[],
): boolean {
  if (currentGroup.some((item) => item.type === 'thinking')) return true;
  return segments.some(
    (segment) =>
      segment.kind === 'tool-group'
      && segment.timeline.some((item) => item.type === 'thinking'),
  );
}

function mergeFinalReplyCandidate(current: string | null, next: string): string | null {
  const trimmed = next.trim();
  if (!trimmed) return current;
  if (current === null) return trimmed;
  if (trimmed.startsWith(current) || current.startsWith(trimmed)) {
    return trimmed.length >= current.length ? trimmed : current;
  }
  return trimmed;
}

/** Claude 流式常先吐正文 delta、后出 thinking；长/markdown 正文不是 phase 短 text */
export function isLikelyDeliverableReply(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= 160) return true;
  if (/^\|[^\n]+\|/m.test(trimmed) || /\n\|[^\n]+\|/m.test(trimmed)) return true;
  if (/^#{1,3}\s+\S+/m.test(trimmed)) return true;
  if ((trimmed.match(/\n/g)?.length ?? 0) >= 3 && trimmed.length >= 100) return true;
  return false;
}

/** OpenClaw / Claude 英文过程旁白（工具调用前叙述），应留在思考区 */
const ENGLISH_PLANNING_LEAD =
  /^(Now let me|Let me|I will|I'll|Next,? I|I need to|Now I'll|I'm going to|I am going to|Okay,? let me|Sure,? let me|First,? I|I'll go ahead and)\b/i;

/** 长段规划旁白（PPT/技能调用前叙述），应留在思考区而非正文 / 工作流 preamble 卡 */
export function isLikelyPlanningNarration(text: string): boolean {
  const trimmed = text.trim();
  if (ENGLISH_PLANNING_LEAD.test(trimmed)) {
    if (trimmed.length < 220) return true;
    if (/\b(search|query|check|look up|find|call|use|tool|skill|workflow|fetch|retrieve)\b/i.test(trimmed)) {
      return true;
    }
  }
  // 短句也可能是批次间规划（搜模板失败 → 换技能），不要落成正文或 preamble 气泡
  if (/^(我来|让我|我将|现在我来|好的|看起来)/.test(trimmed)) {
    if (/工作流模板|技能|PPT|pptx/i.test(trimmed)) return true;
    if (/使用.{0,32}(技能|工具|pptx)/i.test(trimmed)) return true;
  }
  if (trimmed.length < 80) return false;
  if (/^\|[^\n]+\|/m.test(trimmed) || /\n\|[^\n]+\|/m.test(trimmed)) return false;
  if (/^(我来|让我|我将|现在我来|基于|好的)/m.test(trimmed)) return true;
  if (/使用.{0,24}(技能|工具|pptx|PPT|pptxgenjs)/i.test(trimmed)) return true;
  if (/为您生成|创建一份|整理一份/.test(trimmed)) return true;
  return false;
}

export function findLastTextEventIndex(events: RawTurnEvent[]): number {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === 'text') return i;
  }
  return -1;
}

/**
 * 是否将 text 晋升为回合最终正文（Phase 7：结构优先）
 * - 完成态：deliverable 形态可晋升
 * - 完成态：仅最后一条 text event 进正文（含短追问清单），避免误落成 phase-text 触发 figure-two 拆错
 * - 流式：仅最后一条 text event 可晋升，避免中间长文被误收成正文
 */
export function hasToolEventsAfter(
  events: RawTurnEvent[],
  eventIndex: number,
): boolean {
  for (let index = eventIndex + 1; index < events.length; index += 1) {
    if (events[index]?.type === 'tool') return true;
  }
  return false;
}

export function shouldPromoteTextToFinalReply(
  text: string,
  isLiveStream: boolean,
  eventIndex: number,
  lastTextEventIndex: number,
  hasFollowingToolEvents = false,
): boolean {
  if (isLikelyPlanningNarration(text)) return false;
  if (!isLiveStream) {
    if (eventIndex !== lastTextEventIndex) return false;
    if (hasFollowingToolEvents) return false;
    return true;
  }
  if (!isLikelyDeliverableReply(text)) return false;
  if (hasFollowingToolEvents) return false;
  return eventIndex === lastTextEventIndex;
}

/** thinking 到达时，把误放在顶部的 deliverable phase-text 收回为正文 */
function reclaimLeadingDeliverablePhaseText(
  segments: ThinkingTurnSegment[],
  candidateFinalReply: string | null,
): string | null {
  const first = segments[0];
  if (first?.kind !== 'phase-text') return candidateFinalReply;
  if (!isLikelyDeliverableReply(first.text)) return candidateFinalReply;
  if (isLikelyPlanningNarration(first.text)) return candidateFinalReply;
  if (turnHasToolGroups(segments)) return candidateFinalReply;
  const next = mergeFinalReplyCandidate(candidateFinalReply, first.text);
  segments.shift();
  return next;
}

/** 比较用户问题与 assistant 旁白时忽略空白差异 */
export function normalizeComparableQueryText(text: string): string {
  return text.trim().replace(/\s+/g, '');
}

/**
 * OpenClaw 等引擎常把用户原问 echo 成首条 assistant text。
 * 与真实阶段旁白不同，不应在思考区再展示一遍。
 */
export function isEchoOfUserQuery(
  assistantText: string,
  userText: string | null | undefined,
): boolean {
  if (!userText?.trim()) return false;
  const normalizedAssistant = normalizeComparableQueryText(assistantText);
  const normalizedUser = normalizeComparableQueryText(userText);
  if (!normalizedAssistant || !normalizedUser) return false;
  return normalizedAssistant === normalizedUser;
}

/** 去掉与用户问题完全重复的 phase-text（常见于 opening） */
export function dedupePhaseTextsEchoingUserQuery(
  segments: ThinkingTurnSegment[],
  userText: string | null | undefined,
): void {
  if (!userText?.trim()) return;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment?.kind !== 'phase-text') continue;
    if (isEchoOfUserQuery(segment.text, userText)) {
      segments.splice(i, 1);
    }
  }
}

/** 正文已收录时，思考区不再重复展示同一段 phase text（仅精确/全量包含，避免误删批次间旁白） */
export function dedupePhaseTextsAgainstFinalReply(
  segments: ThinkingTurnSegment[],
  finalReplyText: string | null,
): void {
  if (!finalReplyText?.trim()) return;
  const finalTrimmed = finalReplyText.trim();

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment?.kind !== 'phase-text') continue;
    const phaseTrimmed = segment.text.trim();
    if (!phaseTrimmed) {
      segments.splice(i, 1);
      continue;
    }
    // 批次间短旁白也参与去重；与 final 同句开头/前缀重复则移除
    const overlap = classifyTextOverlap(phaseTrimmed, finalTrimmed);
    if (overlap === 'same' || overlap === 'process_prefix_of_final') {
      segments.splice(i, 1);
      continue;
    }
    // 英文/中文规划旁白误入正文时，思考区不再重复展示
    if (isLikelyPlanningNarration(phaseTrimmed) && finalTrimmed.includes(phaseTrimmed)) {
      segments.splice(i, 1);
      continue;
    }
    if (
      finalTrimmed.includes(phaseTrimmed)
      && phaseTrimmed.length >= 80
      && normalizeDisplayTextForOwnership(phaseTrimmed) === normalizeDisplayTextForOwnership(
        finalTrimmed.slice(0, phaseTrimmed.length),
      )
    ) {
      segments.splice(i, 1);
    }
  }
}

export function finalizeReplyText(
  segments: ThinkingTurnSegment[],
  candidateFinalReply: string | null,
): string | null {
  // 完成态清扫：仅回合结束后执行，流式中间 phase 不会被这里 strip
  let finalReplyText = candidateFinalReply;

  if (
    segments.length >= 1
    && segments[0]?.kind === 'phase-text'
    && !turnHasToolGroups(segments)
    && turnHasThinkingContent(segments, [])
    && isLikelyDeliverableReply(segments[0].text)
    && !isLikelyPlanningNarration(segments[0].text)
  ) {
    finalReplyText = mergeFinalReplyCandidate(finalReplyText, segments[0].text);
    segments.shift();
  }

  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last?.kind === 'phase-text') {
      const promoteTrailingPhase =
        isLikelyDeliverableReply(last.text)
        && !isLikelyPlanningNarration(last.text);
      if (promoteTrailingPhase) {
        finalReplyText = mergeFinalReplyCandidate(finalReplyText, last.text);
        segments.pop();
      }
    }
  }

  return finalReplyText;
}

export { mergeFinalReplyCandidate, reclaimLeadingDeliverablePhaseText };
