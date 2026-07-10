import type { ThinkingTimelineItem } from '@/pages/Chat/message-utils';

export type RawTurnEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool'; id: string; name: string; input: unknown };

/** 阶段叙述 text（摘要之间的正文段落，不是最终交付） */
export type ThinkingPhaseTextSegment = {
  kind: 'phase-text';
  key: string;
  text: string;
};

/** 一段 thinking + tool 过程（图一 live / 图三摘要 / 图四展开） */
export type ThinkingToolGroupSegment = {
  kind: 'tool-group';
  key: string;
  timeline: ThinkingTimelineItem[];
  /** completed = 已收成一级摘要；active = 当前 live 二级 */
  state: 'completed' | 'active';
};

export type ThinkingTurnSegment = ThinkingPhaseTextSegment | ThinkingToolGroupSegment;

export type ParsedThinkingTurn = {
  segments: ThinkingTurnSegment[];
  /** 回合结束后最后一段 text，单独作为正文渲染 */
  finalReplyText: string | null;
};

export const INTERRUPTED_PHASE_TEXT_KEY = 'phase-text-interrupted';

/** 开场白 phase-text 固定 key，避免流式 eventIndex 变化导致 React remount 跳动 */
export const OPENING_PHASE_TEXT_KEY = 'phase-text-opening';

export type ParseThinkingTurnStreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
};

import type { TurnTimelineEntry } from '@/pages/Chat/chat-display';
import type { EngineProfileName } from '@/pages/Chat/thinking/engine-profiles';

export type ParseThinkingTurnLayoutOptions = {
  isLiveStream: boolean;
  /** Claude 流式工具：mergedEvents 未到时补 tool + input */
  streamingTools?: ParseThinkingTurnStreamingTool[];
  /** 显式引擎 profile；省略时从 messages 结构推断 */
  engineProfile?: EngineProfileName;
  /** 本轮前一条用户消息正文；OpenClaw 常 echo 成首条 assistant text，用于去重 */
  precedingUserText?: string | null;
  /** session 原始顺序的 assistant + tool_result；完成态从 tool_result 恢复工具 */
  chronologicalEntries?: TurnTimelineEntry[];
  /** 用户 Stop 后标记本回合已中断（Phase 6） */
  wasInterrupted?: boolean;
};
