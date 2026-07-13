/**
 * TurnPart — 思考/工具 timeline 标准化层（Phase 2）
 *
 * 所有来源先归一为 TurnPart[]，再由 adapter 映射到 ThinkingTurnSegment[]。
 * UI 不直接从 raw message 猜顺序。
 */
import type { ToolInputState } from '@/lib/tool-input-merge';

export type TurnPartKind =
  | 'process_text'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'final_text'
  | 'workflow_card'
  | 'confirmed_params'
  | 'artifact'
  | 'waiting'
  | 'error'
  | 'interrupted';

export type TurnPartSource = 'live' | 'history' | 'cache' | 'tool_result';

export type TurnPartStatus = 'running' | 'completed' | 'error' | 'interrupted';

export type TurnPartBase = {
  id: string;
  kind: TurnPartKind;
  firstSeenOrder: number;
  source: TurnPartSource;
  status?: TurnPartStatus;
};

export type ProcessTextTurnPart = TurnPartBase & {
  kind: 'process_text';
  text: string;
};

export type ReasoningTurnPart = TurnPartBase & {
  kind: 'reasoning';
  content: string;
};

export type ToolCallTurnPart = TurnPartBase & {
  kind: 'tool_call';
  toolIdentity: string;
  toolCallId?: string;
  name: string;
  input?: unknown;
  inputState: ToolInputState;
  output?: unknown;
};

export type InterruptedTurnPart = TurnPartBase & {
  kind: 'interrupted';
  labelKey: 'streaming.interrupted';
};

export type TurnPart =
  | ProcessTextTurnPart
  | ReasoningTurnPart
  | ToolCallTurnPart
  | InterruptedTurnPart
  | (TurnPartBase & { kind: Exclude<TurnPartKind, 'process_text' | 'reasoning' | 'tool_call' | 'interrupted'> });

/** 连续 process 类 part 合并后的 UI 组 */
export type TurnProcessGroup = {
  key: string;
  parts: TurnPart[];
  toolCallCount: number;
  reasoningCount: number;
};

export type ReduceTurnPartsOptions = {
  isLiveStream: boolean;
  streamingTools?: Array<{
    id?: string;
    toolCallId?: string;
    name: string;
    input?: unknown;
    status?: 'running' | 'completed' | 'error';
  }>;
};
