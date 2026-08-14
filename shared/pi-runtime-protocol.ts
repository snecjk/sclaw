import type { NormalizedEngineEvent } from '../electron/gateway/normalized-engine-event';

export type PiWorkerCommand =
  | 'runtime.initialize'
  | 'session.open'
  | 'session.prompt'
  | 'session.abort'
  | 'session.history'
  | 'session.inspect'
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
  cwd: string;
  agentDir: string;
  sessionDir: string;
  sessionFile?: string;
  systemPrompt?: string;
  model: PiModelConfig;
  media?: Array<{ filePath: string; mimeType: string; fileName: string }>;
  scheduledAllowedRoots?: string[];
  /** SClaw-managed skill roots exposed to Pi. Project `.pi` resources stay disabled. */
  skillRoots?: string[];
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

export interface PiHistoryResult {
  messages: unknown[];
  isRunning: boolean;
}

export interface PiInspectResult {
  status: 'active' | 'completed' | 'not_started';
  runId?: string;
  currentTurnMessages?: unknown[];
  transcriptRevision?: string;
}
