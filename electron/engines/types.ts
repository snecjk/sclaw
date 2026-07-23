import type { GatewayManager } from '../gateway/manager';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';

export type AgentEngineType = 'openclaw' | 'claude';

export interface EngineSessionSummary {
  key: string;
  label?: string;
  displayName?: string;
  thinkingLevel?: string;
  model?: string;
  updatedAt?: number | string;
  engineType?: AgentEngineType;
  spawnedBy?: string;
}

export interface EngineHistoryResult {
  messages: unknown[];
  thinkingLevel?: string | null;
  isRunning?: boolean;
  runtimeResult?: {
    type?: string;
    subtype?: string;
    stopReason?: string | null;
    isError?: boolean;
    durationMs?: number;
  } | null;
}

/**
 * 引擎无关的权限档位（与 `ScheduleTaskPermissionProfile` 同构，本地定义以避免
 * `engines/types` ↔ `db/models/domain/schedule-task` 的循环依赖）。
 *  - `dangerous-bypass`：跳过权限确认（Claude `bypassPermissions`）
 *  - `workspace-write` / `readonly-safe`：让引擎以默认权限跑（受约束）
 */
export type EnginePermissionProfile = 'readonly-safe' | 'workspace-write' | 'dangerous-bypass';

export interface EngineSendParams {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey: string;
  systemPromptAppend?: string;
  /** 定时任务执行时由 executor 透传；交互式 chat 不设（undefined）以保留引擎默认。 */
  permissionProfile?: EnginePermissionProfile;
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
  prepareMemoryInjection(params: EngineSendParams, memory: AgentMemoryContextBlocks): EngineSendParams;
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
