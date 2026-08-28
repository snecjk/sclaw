/**
 * Bridge AI invocation protocol.
 *
 * Shared between guest SDK, renderer transport and the main-process handler so
 * request/result shapes and error codes have a single source of truth.
 */

/** Default and maximum wall-clock budget for one AI invocation.
 *
 * Guest preload defaults to 30s (see `shared/jsbridge-guest-preload-source.ts`),
 * which is far too short for an agent run, so the SDK must pass `timeoutMs`
 * explicitly. The supervisor deadline is derived from the same value so the
 * three layers cannot drift apart. */
export const BRIDGE_AI_DEFAULT_TIMEOUT_MS = 120_000;
export const BRIDGE_AI_MAX_TIMEOUT_MS = 180_000;

/** Serialized `context` size ceiling. Oversized payloads are rejected rather
 * than silently truncated, since Bridge cannot know which business fields matter. */
export const BRIDGE_AI_MAX_CONTEXT_BYTES = 128 * 1024;

export type BridgeAiResponseFormat = 'text' | 'json';

export type BridgeAiMemoryMode = 'none' | 'app' | 'user-read';

export type BridgeAiSessionMode = 'ephemeral' | 'conversation';

/** Per-app AI configuration. Absent or `enabled: false` means AI is unavailable
 * regardless of which capabilities were granted. */
export interface BridgeAiProfile {
  enabled: boolean;
  agentId?: string;
  /** App-level role and output constraints, injected ahead of guest context. */
  systemPrompt?: string;
  /** Skills injected on every call. */
  skills?: string[];
  /** Skills the guest may additionally request per call. */
  allowedSkillSlugs?: string[];
  responseFormat?: BridgeAiResponseFormat;
  /** Inject webview page context (URL / title / excerpt). Requires renderer help. */
  injectPageContext?: boolean;
  memory?: { mode: BridgeAiMemoryMode };
  session?: { mode: BridgeAiSessionMode; ttlMs?: number };
  /** Independent of the generic bridge rate limit: one AI call is a full agent run. */
  quota?: { perMinute: number; concurrent: number };
}

/** Conservative fallback applied when an app enables AI without declaring quota. */
export const BRIDGE_AI_DEFAULT_QUOTA = { perMinute: 6, concurrent: 1 } as const;

export interface ChatCompleteParams {
  prompt: string;
  context?: unknown;
  agentId?: string;
  skillSlugs?: string[];
  responseFormat?: BridgeAiResponseFormat;
  /** Reuse for multi-turn; omitted means a fresh single-shot session. */
  conversationId?: string;
  timeoutMs?: number;
}

export type BridgeAiFinishReason = 'completed' | 'timeout' | 'aborted' | 'failed';

export interface ChatCompleteResult {
  requestId: string;
  runId: string | null;
  text: string;
  /** Present when `responseFormat: 'json'` and parsing succeeded. */
  parsed?: unknown;
  /** Why parsing failed; raw output is still available in `text`. */
  parseError?: string;
  finishReason: BridgeAiFinishReason;
}

export interface ChatCancelParams {
  requestId: string;
}

export interface ChatCancelResult {
  ok: boolean;
}

export interface ChatInvokeAgentParams extends ChatCompleteParams {}

export interface ChatInvokeAgentResult {
  requestId: string;
  sessionKey: string;
}

/** Guest-facing stream event channel name (delivered over `jsbridge:event`). */
export const BRIDGE_AI_STREAM_EVENT = 'chat:stream' as const;

export type ChatStreamEvent =
  | { requestId: string; type: 'start' }
  | { requestId: string; type: 'delta'; text: string; seq: number }
  | { requestId: string; type: 'tool'; name: string; status: string }
  | { requestId: string; type: 'done'; text: string }
  | { requestId: string; type: 'error'; code: BridgeAiErrorCode; message: string }
  | { requestId: string; type: 'aborted' };

/**
 * AI-specific error codes.
 *
 * `AI_NOT_ENABLED` is deliberately distinct from the generic capability denial:
 * an app may hold the capability (e.g. `internal` tier grants all capabilities)
 * while its AI profile is disabled, and callers need to tell the two apart.
 */
export type BridgeAiErrorCode =
  | 'AI_NOT_ENABLED'
  | 'AI_INVALID_PARAMS'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_SKILL_NOT_ALLOWED'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_CONCURRENCY_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_ABORTED'
  | 'AI_RUN_FAILED';
