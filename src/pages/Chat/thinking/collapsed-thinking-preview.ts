import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';
import type { LiveProcessActivity } from '@/pages/Chat/thinking/live-process-activity';
import { liveTextTail } from '../../../../shared/chat-live-append';

/** 折叠条第二行最多展示的字数（单行省略前的逻辑截断）。 */
export const COLLAPSED_THINKING_PREVIEW_CHARS = 56;

const SENTENCE_PUNCT = /[。！？.!?；;]/;

/**
 * 从思考正文抽出折叠预览：取最后一句；超长句取尾部，保证流式时预览跟着最新字走。
 */
export function extractCollapsedThinkingPreview(
  text: string,
  maxChars = COLLAPSED_THINKING_PREVIEW_CHARS,
): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  let start = 0;
  for (let index = 0; index < trimmed.length - 1; index += 1) {
    if (SENTENCE_PUNCT.test(trimmed[index] ?? '')) start = index + 1;
  }
  const last = trimmed.slice(start).trim() || trimmed;
  if (last.length <= maxChars) return last;
  return `…${last.slice(-maxChars)}`;
}

export function lastThinkingContent(
  timeline: readonly ThinkingTimelineItem[],
): string {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.type !== 'thinking') continue;
    if (item.liveParts?.length) return liveTextTail(item.liveParts);
    if (item.content.trim()) return item.content;
  }
  return '';
}

export function resolveCollapsedLivePreview(options: {
  activity: LiveProcessActivity;
  timeline: readonly ThinkingTimelineItem[];
  toolDisplayName?: string;
  phaseText?: string | null;
}): string {
  if (options.activity.kind === 'tool') {
    return options.toolDisplayName?.trim() || options.activity.name;
  }
  const thinking = lastThinkingContent(options.timeline);
  if (thinking) return extractCollapsedThinkingPreview(thinking);
  if (options.phaseText?.trim()) {
    return extractCollapsedThinkingPreview(options.phaseText);
  }
  return '';
}
