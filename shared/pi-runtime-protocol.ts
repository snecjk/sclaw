import type { NormalizedEngineEvent } from '../electron/gateway/normalized-engine-event';

export type PiWorkerCommand =
  | 'runtime.initialize'
  | 'session.open'
  | 'session.prompt'
  | 'session.abort'
  | 'session.history'
  | 'session.inspect'
  | 'session.contextUsage'
  | 'session.compact'
  | 'session.delete'
  | 'runtime.shutdown';

export interface PiModelConfig {
  provider: string;
  model: string;
  accountId?: string;
  apiKey?: string;
  baseUrl?: string;
  apiProtocol?: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  headers?: Record<string, string>;
}

export interface PiSessionConfig {
  sessionKey: string;
  agentId?: string;
  cwd: string;
  agentDir: string;
  /** Whether project-local Pi configuration may be honored. Defaults closed. */
  projectTrusted?: boolean;
  sessionDir: string;
  sessionFile?: string;
  systemPrompt?: string;
  model: PiModelConfig;
  /** Keeps scheduled-only extension semantics without changing filesystem access. */
  sessionMode?: 'interactive' | 'scheduled';
  /** Workflow runners reuse Pi skills and tools without loading chat business extensions. */
  disableAgentExtensions?: boolean;
  /** SClaw-managed Skill roots selected for Pi's native Skill loader. */
  skillRoots?: string[];
  /** Exact per-turn selection used for diagnostics and usage attribution. */
  selectedSkills?: Array<{ slug: string; path: string; sourceHash: string }>;
  /** Stable hash of the native Skill selection. */
  skillSetHash?: string;
}

export interface PiPromptAttachment {
  filePath: string;
  mimeType: string;
  fileName: string;
}

export interface PiPromptPayload {
  config: PiSessionConfig;
  message: string;
  runId: string;
  /** Per-turn Memory/business context appended only for this model turn. */
  systemPromptAppend?: string;
  media: PiPromptAttachment[];
  /** Structured Main prompt already contains canonical <file> references. */
  referencesEmbedded?: boolean;
}

export interface PiWorkerRequest {
  requestId: string;
  command: PiWorkerCommand;
  sessionKey?: string;
  payload?: Record<string, unknown>;
}

export interface SerializedPiError {
  message: string;
  stack?: string;
  code?: string;
}

export type PiWorkerMessage =
  | { type: 'runtime.ready' }
  | { type: 'runtime.failed'; error: SerializedPiError }
  | { type: 'engine.event'; sessionKey: string; event: NormalizedEngineEvent }
  | { type: 'response'; requestId: string; success: boolean; result?: unknown; error?: SerializedPiError };

export interface PiPromptResult {
  runId: string;
  sessionId: string;
  sessionFile?: string;
}

export interface PiContextUsageResult {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
}

export interface PiHistoryResult {
  messages: unknown[];
  isRunning: boolean;
  hasMore: boolean;
  totalCount: number;
}

export interface PiInspectResult {
  status: 'active' | 'completed' | 'failed' | 'not_started';
  runId?: string;
  currentTurnMessages?: unknown[];
  transcriptRevision?: string;
  reason?: string;
}
