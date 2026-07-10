/**
 * TurnLifecycle — 统一轮次运行生命周期（docs/对话流全局稳定化修改方案-Cursor.md §4.1）
 *
 * 展示层不得各自猜测「是否结束 / 能否展示 meta」；须走 resolveTurnLifecycle。
 * 使用位置：ChatMessage meta、use-chat-display、AssistantTurnMessage。
 */

export type TurnLifecycleStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'tool_running'
  | 'organizing_tool_results'
  | 'waiting_user'
  | 'queued'
  | 'interrupted'
  | 'completed'
  | 'failed';

export type TurnEngineType = 'openclaw' | 'claude';

export interface TurnLifecycle {
  /** 轮次稳定 key（可选，供 debug / 埋点） */
  turnKey?: string;
  engineType?: TurnEngineType;
  runId?: string | null;
  status: TurnLifecycleStatus;
  /** 是否已进入终态（completed / failed / interrupted） */
  isTerminal: boolean;
  /** 是否可展示复制 + 时间 meta（§4.1: isTerminal && status === 'completed'） */
  canShowMeta: boolean;
  canAutoScroll: boolean;
}

export interface ResolveTurnLifecycleOptions {
  turnKey?: string;
  engineType?: TurnEngineType;
  runId?: string | null;
  sending: boolean;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  activeRunId: string | null;
  /** 该助手行是否仍在 token 流式输出 */
  isStreaming: boolean;
  /** 参数表单待提交等 */
  isAwaitingUserToContinue: boolean;
  /** 工作流非终态 / 填表等（不含 sending，由上方字段覆盖） */
  hasWorkflowBlockers: boolean;
  isInterrupted?: boolean;
  error?: string | null;
  isQueued?: boolean;
}

/**
 * 从 store + 展示层信号计算统一生命周期。
 * OpenClaw / Claude 中间 assistant final 不改变 status，只有 terminal 信号才 completed。
 */
export function resolveTurnLifecycle(options: ResolveTurnLifecycleOptions): TurnLifecycle {
  const {
    sending,
    pendingFinal,
    lastUserMessageAt,
    activeRunId,
    isStreaming,
    isAwaitingUserToContinue,
    hasWorkflowBlockers,
    isInterrupted = false,
    error = null,
    isQueued = false,
  } = options;

  let status: TurnLifecycleStatus = 'idle';

  if (isInterrupted) {
    status = 'interrupted';
  } else if (error) {
    status = 'failed';
  } else if (isQueued) {
    status = 'queued';
  } else if (isAwaitingUserToContinue) {
    status = 'waiting_user';
  } else if (sending || lastUserMessageAt != null || activeRunId != null) {
    if (pendingFinal) {
      status = 'organizing_tool_results';
    } else if (isStreaming) {
      status = 'streaming';
    } else if (activeRunId != null) {
      status = 'tool_running';
    } else if (sending) {
      status = 'connecting';
    } else {
      status = 'streaming';
    }
  } else if (hasWorkflowBlockers) {
    status = 'waiting_user';
  } else {
    status = 'completed';
  }

  const isTerminal =
    status === 'completed'
    || status === 'failed'
    || status === 'interrupted';

  const canShowMeta = status === 'completed' && isTerminal;

  return {
    turnKey: options.turnKey,
    engineType: options.engineType,
    runId: options.runId,
    status,
    isTerminal,
    canShowMeta,
    canAutoScroll: !isTerminal || status === 'completed',
  };
}

export interface CanShowAssistantTurnMetaOptions {
  hasAssistantMetaContent: boolean;
  isLastAssistantInTurn: boolean;
  isInCurrentUserTurn: boolean;
  lifecycle: TurnLifecycle;
}

/**
 * 是否可在助手回复下方展示复制 + 时间 meta。
 * 必须读 lifecycle.canShowMeta，禁止局部猜 sending/streaming。
 */
export function canShowAssistantTurnMeta(options: CanShowAssistantTurnMetaOptions): boolean {
  if (!options.hasAssistantMetaContent || !options.isLastAssistantInTurn) return false;
  if (!options.isInCurrentUserTurn) return true;
  return options.lifecycle.canShowMeta;
}

/** ChatMessage 用：从 store 字段 + 轮次阻塞态构造 lifecycle */
export function resolveCurrentTurnLifecycleForMeta(options: {
  sending: boolean;
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  activeRunId: string | null;
  isStreaming: boolean;
  isAwaitingUserToContinue: boolean;
  isInterrupted?: boolean;
  /** isCurrentUserTurnIncomplete 中 workflow / schema / 填表部分 */
  hasWorkflowBlockers: boolean;
  engineType?: TurnEngineType;
  runId?: string | null;
}): TurnLifecycle {
  return resolveTurnLifecycle({
    engineType: options.engineType,
    runId: options.runId,
    sending: options.sending,
    pendingFinal: options.pendingFinal,
    lastUserMessageAt: options.lastUserMessageAt,
    activeRunId: options.activeRunId,
    isStreaming: options.isStreaming,
    isAwaitingUserToContinue: options.isAwaitingUserToContinue,
    hasWorkflowBlockers: options.hasWorkflowBlockers,
    isInterrupted: options.isInterrupted,
  });
}
