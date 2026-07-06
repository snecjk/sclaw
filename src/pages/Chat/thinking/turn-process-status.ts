/**
 * TurnProcessStatus — loading 文案唯一来源（非多个布尔拼装）
 *
 * 对齐 docs/对话流三项问题全局修复-Cursor执行文档.md §4.3
 */
import { resolveToolInputState } from '@/lib/tool-input-merge';
import type { ConnectingLabelKey } from '@/pages/Chat/thinking/types-ui';

export type TurnProcessStatus =
  | 'idle'
  | 'connecting'
  | 'thinking'
  | 'tool_input_streaming'
  | 'tool_running'
  | 'organizing_tool_results'
  | 'finalizing'
  | 'waiting_user'
  | 'queued'
  | 'still_executing'
  | 'interrupted'
  | 'failed'
  | 'completed';

export interface ResolveTurnProcessStatusInput {
  isLiveStream: boolean;
  isConnecting: boolean;
  isProcessing: boolean;
  isStillExecuting: boolean;
  streamingTools: Array<{ status: string; input?: unknown }>;
  /** 思考区已有 segment / 流式工具 */
  hasProcessSegments: boolean;
  /** 正文气泡正在流式输出 */
  hasFinalReplyStreaming: boolean;
  isWaitingUser?: boolean;
  isQueued?: boolean;
  isInterrupted?: boolean;
  isFailed?: boolean;
}

export function resolveTurnProcessStatus(input: ResolveTurnProcessStatusInput): TurnProcessStatus {
  if (!input.isLiveStream) {
    if (input.isInterrupted) return 'interrupted';
    if (input.isFailed) return 'failed';
    return 'completed';
  }

  if (input.isInterrupted) return 'interrupted';
  if (input.isFailed) return 'failed';
  if (input.isWaitingUser) return 'waiting_user';
  if (input.isQueued) return 'queued';

  const runningTool = input.streamingTools.find((tool) => tool.status === 'running');
  if (runningTool) {
    const inputState = resolveToolInputState(runningTool.input, 'running');
    if (inputState === 'unknown' || inputState === 'partial') {
      return 'tool_input_streaming';
    }
    return 'tool_running';
  }

  if (input.isProcessing) return 'organizing_tool_results';
  if (input.hasFinalReplyStreaming) return 'finalizing';

  if (
    input.hasProcessSegments
    && !input.isConnecting
    && !input.isProcessing
  ) {
    return 'thinking';
  }

  if (input.isConnecting) return 'connecting';
  if (input.isStillExecuting) return 'still_executing';

  // turn 未完成但无可见内容：兜底，禁止 loading 消失
  if (input.isLiveStream) return 'still_executing';

  return 'idle';
}

/** i18n key（chat namespace）；null 表示不展示普通 loading */
export function resolveProcessStatusLabelKey(
  status: TurnProcessStatus,
  connectingLabelKey: ConnectingLabelKey = 'understandingQuestion',
): string | null {
  switch (status) {
    case 'connecting':
      return `streaming.${connectingLabelKey}`;
    case 'thinking':
      return 'streaming.thinkingNow';
    case 'tool_input_streaming':
      return 'streaming.preparingToolInput';
    case 'tool_running':
      return 'streaming.runningTool';
    case 'organizing_tool_results':
      return 'streaming.processingTitle';
    case 'finalizing':
      return 'streaming.finalizingReply';
    case 'waiting_user':
      return 'streaming.awaitingReply';
    case 'queued':
      return 'streaming.queued';
    case 'still_executing':
      return 'streaming.stillExecuting';
    default:
      return null;
  }
}

export function shouldShowProcessStatusLoading(status: TurnProcessStatus): boolean {
  return resolveProcessStatusLabelKey(status) !== null;
}
