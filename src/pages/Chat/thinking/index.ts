export type {
  ParseThinkingTurnLayoutOptions,
  ParseThinkingTurnStreamingTool,
  ParsedThinkingTurn,
  ThinkingPhaseTextSegment,
  ThinkingToolGroupSegment,
  ThinkingTurnSegment,
} from '@/pages/Chat/thinking/types';
export { OPENING_PHASE_TEXT_KEY } from '@/pages/Chat/thinking/types';

export {
  dedupePhaseTextsAgainstFinalReply,
  finalizeReplyText,
  findLastTextEventIndex,
  isLikelyDeliverableReply,
  isLikelyPlanningNarration,
  isLikelyUserClarificationReply,
  shouldPromoteTextToFinalReply,
} from '@/pages/Chat/thinking/classify-text';

export {
  CLAUDE_ENGINE_PROFILE,
  OPENCLAW_ENGINE_PROFILE,
  resolveEngineProfile,
  type EngineProfile,
  type EngineProfileName,
} from '@/pages/Chat/thinking/engine-profiles';

export {
  buildThinkingGroupSummaryLabel,
  parseThinkingTurnLayout,
  rebalanceThinkingTimelineForDisplay,
} from '@/pages/Chat/thinking-turn-segments';
