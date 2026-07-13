/**
 * 思考过程 UI 模块入口（Phase 2 拆分后由本文件 re-export，保持旧 import 路径不变）
 */
export {
  AwaitingReplyIndicator,
  ConnectingModelIndicator,
  type ConnectingLabelKey,
  type ConnectingModelIndicatorProps,
} from '@/pages/Chat/thinking/connecting-indicators';

export { PhaseTextBlock, type PhaseTextBlockProps } from '@/pages/Chat/thinking/phase-text-block';

export {
  ThinkingTurnProcess,
  type ThinkingTurnProcessProps,
} from '@/pages/Chat/thinking/thinking-turn-process';

export {
  ThinkingProcessPanel,
  type ThinkingProcessPanelProps,
} from '@/pages/Chat/thinking/thinking-process-panel';
