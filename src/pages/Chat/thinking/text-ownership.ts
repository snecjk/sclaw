/**
 * TextOwnership — 同一段文本只能出现在一个 surface（process / final / hidden）
 *
 * 对齐 docs/对话流三项问题全局修复-Cursor执行文档.md §2.3–§2.5
 * 使用位置：parseThinkingTurnLayout 输出前；UI 只消费结果，不做字符串 includes 去重。
 */
import { isLikelyPlanningNarration } from '@/pages/Chat/thinking/classify-text';
import type { ParsedThinkingTurn, ThinkingTurnSegment } from '@/pages/Chat/thinking/types';

export type TextSurface = 'hidden' | 'process' | 'final' | 'preamble';

export type TextOverlapKind =
  | 'same'
  | 'final_prefix_of_process'
  | 'process_prefix_of_final'
  | 'different';

export interface ApplyTextOwnershipOptions {
  /** live 流式：final 仅为 process 前缀时隐藏 final 气泡 */
  isLiveStream?: boolean;
}

/** 轻量归一化：空白/冒号差异；不破坏 markdown/路径/命令 */
export function normalizeDisplayTextForOwnership(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*[：:]\s*/g, ':')
    .trim();
}

/**
 * 方向性 overlap：process 为较长侧，final 为较短/候选正文侧。
 * 阈值只防几字误删，不用 85% 比例。
 */
export function classifyTextOverlap(processText: string, finalText: string): TextOverlapKind {
  const process = normalizeDisplayTextForOwnership(processText);
  const final = normalizeDisplayTextForOwnership(finalText);
  if (!process || !final) return 'different';
  if (process === final) return 'same';
  if (process.startsWith(final) && final.length >= 24) return 'final_prefix_of_process';
  if (final.startsWith(process) && process.length >= 24) return 'process_prefix_of_final';
  if (process.includes(final) && final.length >= 40) return 'final_prefix_of_process';
  if (final.includes(process) && process.length >= 40) return 'process_prefix_of_final';
  return 'different';
}

/** 两段文本是否完整重复（对称场景，供 classify-text 过渡使用） */
export function textsAreOwnershipDuplicates(a: string, b: string): boolean {
  return classifyTextOverlap(a, b) === 'same';
}

const OVERLAP_PRIORITY: Record<TextOverlapKind, number> = {
  same: 4,
  process_prefix_of_final: 3,
  final_prefix_of_process: 2,
  different: 0,
};

/** 思考区是否已完整展示 target 文本（供 UI fallback 兜底，避免正文气泡重复） */
export function processSegmentsCoverText(
  segments: ThinkingTurnSegment[],
  text: string,
): boolean {
  const target = text.trim();
  if (!target) return false;

  const processTexts = collectProcessTexts(segments);

  return processTexts.some((processText) => {
    const overlap = classifyTextOverlap(processText, target);
    return (
      overlap === 'same'
      || overlap === 'process_prefix_of_final'
      || overlap === 'final_prefix_of_process'
    );
  });
}

/**
 * process 侧已「拥有」该正文（same / final 仅为 process 前缀）时，气泡不应再渲染。
 * 与 processSegmentsCoverText 不同：不含 process_prefix_of_final（那种情况应由 final 气泡展示）。
 */
export function processSegmentsOwnText(
  segments: ThinkingTurnSegment[],
  text: string,
): boolean {
  const target = text.trim();
  if (!target) return false;

  return collectProcessTexts(segments).some((processText) => {
    const overlap = classifyTextOverlap(processText, target);
    return overlap === 'same' || overlap === 'final_prefix_of_process';
  });
}

function collectProcessTexts(segments: ThinkingTurnSegment[]): string[] {
  const texts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === 'phase-text') {
      const trimmed = segment.text.trim();
      if (trimmed) texts.push(trimmed);
      continue;
    }
    for (const item of segment.timeline) {
      if (item.type === 'thinking' || item.type === 'narration') {
        const trimmed = item.content.trim();
        if (trimmed) texts.push(trimmed);
      }
    }
  }
  return texts;
}

function findStrongestOverlap(
  processTexts: string[],
  finalText: string,
): TextOverlapKind {
  let strongest: TextOverlapKind = 'different';
  for (const processText of processTexts) {
    const kind = classifyTextOverlap(processText, finalText);
    if (OVERLAP_PRIORITY[kind] > OVERLAP_PRIORITY[strongest]) {
      strongest = kind;
    }
  }
  return strongest;
}

function processTextShouldBeRemoved(
  processText: string,
  finalText: string,
  kindsToRemove: TextOverlapKind[],
): boolean {
  const kind = classifyTextOverlap(processText, finalText);
  return kindsToRemove.includes(kind);
}

function removeOverlappingProcessContent(
  segments: ThinkingTurnSegment[],
  finalText: string,
  kindsToRemove: TextOverlapKind[],
): ThinkingTurnSegment[] {
  const result: ThinkingTurnSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === 'phase-text') {
      if (processTextShouldBeRemoved(segment.text, finalText, kindsToRemove)) {
        continue;
      }
      result.push(segment);
      continue;
    }

    const timeline = segment.timeline.filter((item) => {
      if (item.type === 'thinking' || item.type === 'narration') {
        return !processTextShouldBeRemoved(item.content, finalText, kindsToRemove);
      }
      return true;
    });

    const hadTool = segment.timeline.some((item) => item.type === 'tool');
    const hasTool = timeline.some((item) => item.type === 'tool');
    if (!hasTool && hadTool) {
      // 保留仅含 tool 的组结构；若 timeline 全空则丢弃
      if (timeline.length === 0) continue;
    }
    if (timeline.length === 0 && !hadTool) continue;

    result.push({ ...segment, timeline });
  }

  return result;
}

/**
 * 统一文本归属：先收集 process 候选 + final，判定 overlap，再一次性删除/隐藏。
 * planning narration 优先 process；交付正文优先 final。
 */
export function applyTextOwnershipToParsedTurn(
  layout: ParsedThinkingTurn,
  _options: ApplyTextOwnershipOptions = {},
): ParsedThinkingTurn {
  const finalTrimmed = layout.finalReplyText?.trim() ?? '';
  if (!finalTrimmed) return layout;

  if (isLikelyPlanningNarration(finalTrimmed)) {
    return {
      segments: layout.segments,
      finalReplyText: null,
    };
  }

  const processTexts = collectProcessTexts(layout.segments);
  if (processTexts.length === 0) return layout;

  const overlap = findStrongestOverlap(processTexts, finalTrimmed);
  if (overlap === 'different') return layout;

  if (overlap === 'final_prefix_of_process') {
    // process 已展示更长/完整块：隐藏 final（live 早期前缀与 completed 均只保留 process）
    return {
      segments: layout.segments,
      finalReplyText: null,
    };
  }

  // same 或 process_prefix_of_final：正文侧已含该内容，从 process 移除重复
  const segments = removeOverlappingProcessContent(
    layout.segments,
    finalTrimmed,
    ['same', 'process_prefix_of_final'],
  );

  return {
    segments,
    finalReplyText: layout.finalReplyText,
  };
}
