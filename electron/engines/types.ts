import type { GatewayManager } from '../gateway/manager';

export type AgentEngineType = 'openclaw' | 'claude';

export interface EngineSessionSummary {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
  updatedAt?: number | string;
  engineType?: AgentEngineType;
}

export interface EngineHistoryResult {
  messages: unknown[];
  thinkingLevel?: string | null;
  isRunning?: boolean;
}

export interface EngineSendParams {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey: string;
}

export interface EngineSendWithMediaParams extends EngineSendParams {
  media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
}

export interface EngineAbortParams {
  sessionKey: string;
}

export interface EngineAdapterContext {
  gatewayManager: GatewayManager;
}

export interface EngineAdapter {
  type: AgentEngineType;
  abortRun(ctx: EngineAdapterContext, params: EngineAbortParams): Promise<{ success: boolean; error?: string }>;
  getHistory(
    ctx: EngineAdapterContext,
    params: { sessionKey: string; limit: number },
  ): Promise<{ success: boolean; result?: EngineHistoryResult; error?: string }>;
  listSessions(ctx: EngineAdapterContext): Promise<{ success: boolean; result?: { sessions: EngineSessionSummary[] }; error?: string }>;
  sendMessage(
    ctx: EngineAdapterContext,
    params: EngineSendParams,
  ): Promise<{ success: boolean; result?: { runId?: string }; error?: string }>;
  sendMessageWithMedia(
    ctx: EngineAdapterContext,
    params: EngineSendWithMediaParams,
  ): Promise<{ success: boolean; result?: { runId?: string }; error?: string }>;
}
