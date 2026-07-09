/**
 * TurnPart normalizer 入口 — re-export parseThinkingTurnLayout（Phase 4）
 *
 * live/history 已在 thinking-turn-segments 内统一走 reducer + adapter。
 */
export {
  parseThinkingTurnLayout as normalizeThinkingTurn,
  buildMergedRawTurnEvents,
} from '@/pages/Chat/thinking-turn-segments';

export type { ParseThinkingTurnLayoutOptions as NormalizeThinkingTurnOptions } from '@/pages/Chat/thinking/types';

export type { TurnPart, TurnProcessGroup } from '@/pages/Chat/thinking/turn-parts';
export { reduceTurnParts } from '@/pages/Chat/thinking/turn-part-reducer';
export { groupTurnParts } from '@/pages/Chat/thinking/turn-part-groups';
export { applyTurnPartsToParsedTurn } from '@/pages/Chat/thinking/turn-part-adapter';
