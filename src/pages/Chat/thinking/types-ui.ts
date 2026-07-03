/** 流式工具状态（与 runtime streamingTools 对齐） */
export type ThinkingStreamingTool = {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  input?: unknown;
  summary?: string;
};

export type ConnectingLabelKey = 'connectingModel' | 'understandingQuestion' | 'stillExecuting';

export interface ConnectingModelIndicatorProps {
  className?: string;
  labelKey?: ConnectingLabelKey;
}
