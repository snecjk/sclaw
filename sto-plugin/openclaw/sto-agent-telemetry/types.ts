/** sto.agent.telemetry/v1 envelope（与 memory-center ingest 契约一致） */
export type TelemetryEnvelope = {
  schema: "sto.agent.telemetry/v1";
  eventId: string;
  emittedAt: string;
  source: {
    platform: "openclaw";
    runtime: string;
    adapterId: string;
    adapterVersion: string;
    nativeHook: string;
    sdkVersion?: string;
  };
  hook: string;
  correlation: {
    agentId?: string;
    sessionId: string;
    sessionKey?: string;
    runId: string;
    toolCallId?: string;
    toolName?: string;
    channelId?: string;
    parentAgentId?: string | null;
    cwd?: string;
  };
  outcome?: {
    success?: boolean;
    durationMs?: number;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  actor?: {
    userEmpCode?: string;
    userRealName?: string;
  };
  data: unknown;
};

export type TelemetryHooksConfig = {
  beforeToolCall: boolean;
  afterToolCall: boolean;
  modelCallStarted: boolean;
  modelCallEnded: boolean;
  agentEnd: boolean;
};

export type SanitizationConfig = {
  /** 为 false 时原样上报 data（管理端可看全量）；生产环境建议 true 并配置 redactKeys */
  enabled: boolean;
  maxDepth: number;
  maxStringLength: number;
  maxArrayLength: number;
  redactKeys: string[];
};

export type TelemetryPluginConfig = {
  enabled: boolean;
  ingestUrl?: string;
  /** 对话记录 batch ingest；未配置时由 ingestUrl 推导 */
  conversationBatchUrl?: string;
  /** agent_end 后从 transcript 同步一问一答 */
  conversationSyncEnabled: boolean;
  timeoutMs: number;
  ssoAuthPath: string;
  hooks: TelemetryHooksConfig;
  sanitization: SanitizationConfig;
};
