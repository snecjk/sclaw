import type { GatewayManager } from '../gateway/manager';
import type { AgentMemoryContextBlocks } from '../../shared/agent-memory-prompt';
import type { ChatHistoryFingerprint } from '../../shared/chat-history-fingerprint';
import type { ChatRuntimePolicy } from '../../shared/chat-runtime-protocol';
import type { ExecutionSnapshot } from './execution-snapshot';
import type { AgentEngineType } from '../../shared/agent-engine';

export type { AgentEngineType } from '../../shared/agent-engine';

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
  fingerprint?: ChatHistoryFingerprint;
  unchanged?: boolean;
  hasMore?: boolean;
  totalCount?: number;
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
  /** 发送来源语义；adapter 据此选择引擎原生 system prompt 或用户消息兼容封装。 */
  runtimePolicy?: ChatRuntimePolicy;
  /** 定时任务执行时由 executor 透传；交互式 chat 不设（undefined）以保留引擎默认。 */
  permissionProfile?: EnginePermissionProfile;
  /** 定时任务允许访问的根目录；仅受限运行时使用，交互式会话不设置。 */
  allowedRoots?: string[];
  /** 受限任务的固定 cwd；普通对话不设置。 */
  cwdOverride?: string;
}

export interface EngineSendWithMediaParams extends EngineSendParams {
  media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
}

export interface EngineAbortParams {
  sessionKey: string;
}

export interface EngineAdapterContext {
  gatewayManager?: GatewayManager;
  /** 引擎无关事件出口；迁移期未设置时 adapter 可复用 gatewayManager。 */
  eventSink?: { emit(event: string, payload: unknown): unknown };
  /** Main 提供的通用运行时服务集合，避免 adapter 强依赖 Gateway。 */
  runtimeServices?: Record<string, unknown>;
}

export function requireGatewayManager(ctx: EngineAdapterContext): GatewayManager {
  if (!ctx.gatewayManager) throw new Error('ENGINE_RUNTIME_UNAVAILABLE: GatewayManager is required');
  return ctx.gatewayManager;
}

export interface EngineRuntimeInspection {
  status: 'active' | 'completed' | 'failed' | 'not_started' | 'unknown';
  runId?: string;
  currentTurnMessages?: unknown[];
  transcriptRevision?: string;
  reason?: string;
}

export interface EngineChatCapabilities {
  hasReliableRuntimeStatus: boolean;
  hasStructuredReasoningEvents: boolean;
  hasStructuredToolEvents: boolean;
  requiresHistoryProjection: boolean;
}

export interface EngineScheduledTaskCapabilities {
  defaultPermissionProfile?: EnginePermissionProfile;
  enforcedPermissionProfile?: EnginePermissionProfile;
  requiresWorkspacePath: boolean;
  supportsWorkflow: boolean;
  restrictToAllowedRoots: boolean;
}

export interface EngineAdapter {
  type: AgentEngineType;
  chatCapabilities: EngineChatCapabilities;
  scheduledTaskCapabilities: EngineScheduledTaskCapabilities;
  inspectRun(
    ctx: EngineAdapterContext,
    params: { sessionKey: string; runId?: string | null; startedAt: number; limit?: number },
  ): Promise<EngineRuntimeInspection>;
  classifyFinalMessage(input: {
    message: unknown;
    phase?: string;
  }): 'completed' | 'awaiting_transcript' | 'progress';
  prepareMemoryInjection(params: EngineSendParams, memory: AgentMemoryContextBlocks): EngineSendParams;
  abortRun(ctx: EngineAdapterContext, params: EngineAbortParams): Promise<{
    success: boolean;
    error?: string;
    result?: { aborted?: boolean; runIds?: unknown[] };
  }>;
  getHistory(
    ctx: EngineAdapterContext,
    params: { sessionKey: string; limit: number; beforeId?: string },
  ): Promise<{ success: boolean; result?: EngineHistoryResult; error?: string }>;
  getExecutionSnapshot(
    ctx: EngineAdapterContext,
    params: { sessionKey: string; limit: number },
  ): Promise<{ success: boolean; result?: ExecutionSnapshot | null; error?: string }>;
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
