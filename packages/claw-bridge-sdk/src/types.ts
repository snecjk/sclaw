export const JSBRIDGE_PROTOCOL = 'stoclaw-bridge/v1' as const;
export const JSBRIDGE_VERSION = '1.0.0';

export type BridgeErrorCode =
  | 'INVALID_PROTOCOL'
  | 'INVALID_SESSION'
  | 'SESSION_EXPIRED'
  | 'ORIGIN_DENIED'
  | 'CAPABILITY_DENIED'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'USER_CONSENT_REQUIRED'
  | 'USER_CONSENT_DENIED'
  | 'RATE_LIMITED'
  | 'METHOD_NOT_FOUND'
  | 'INVALID_PARAMS'
  | 'INTERNAL_ERROR'
  | 'REQUEST_TIMEOUT'
  | 'REPLAY_DETECTED'
  | 'BRIDGE_UNAVAILABLE'
  | 'AI_NOT_ENABLED'
  | 'AI_INVALID_PARAMS'
  | 'AI_CONTEXT_TOO_LARGE'
  | 'AI_SKILL_NOT_ALLOWED'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_CONCURRENCY_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_ABORTED'
  | 'AI_RUN_FAILED';

/** Default wall-clock budget for one headless AI call (guest preload default is 30s). */
export const BRIDGE_AI_DEFAULT_TIMEOUT_MS = 120_000;

/** Maximum allowed `timeoutMs` for `chat.complete`. */
export const BRIDGE_AI_MAX_TIMEOUT_MS = 180_000;

/** Serialized `context` byte ceiling for `chat.complete`. */
export const BRIDGE_AI_MAX_CONTEXT_BYTES = 128 * 1024;

export interface BridgeError extends Error {
  code: BridgeErrorCode;
  details?: Record<string, unknown>;
}

export interface CallOptions {
  timeoutMs?: number;
  userGesture?: boolean;
}

export interface UserGetInfoResult {
  userId: string;
  userName: string;
  realName: string;
  empCode: string;
  companyCode: string;
  companyName: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string;
  isAdministrator: boolean;
}

export interface AuthGetAuthModeResult {
  loggedIn: boolean;
  authMode: 'native-hq' | 'native-site' | 'hq-demo-as-site' | null;
  ssoEnvironment: string;
}

export interface UiAlertParams {
  title?: string;
  message: string;
  confirmLabel?: string;
}

export interface UiConfirmParams {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface UiConfirmResult {
  confirmed: boolean;
}

export interface UiToastParams {
  message: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

export interface UiOpenDrawerParams {
  kind?: 'chat';
}

export interface NavJumpParams {
  type: 'webview' | 'app' | 'route' | 'external';
  url?: string;
  appId?: string;
  route?: string;
  title?: string;
}

export interface NavOpenTabParams {
  url: string;
  title?: string;
}

export interface NavOpenAppParams {
  appId: string;
  title?: string;
}

export type ChatTarget = 'embed' | 'main' | 'auto';

/** 结构化输入框片段（`chat.fillComposer` segments） */
export type ComposerFillSegment =
  | { type: 'text'; text: string }
  | { type: 'skill'; slug: string; title?: string }
  | { type: 'workflow'; id: string; name?: string };

export interface ChatFillComposerParams {
  /** 向后兼容：等价于单个 text segment */
  text?: string;
  /** 结构化片段；与 text 至少提供一个 */
  segments?: ComposerFillSegment[];
  target?: ChatTarget;
  send?: boolean;
  openPanel?: boolean;
}

export interface ChatOpenSessionParams {
  target?: 'embed' | 'main';
  text?: string;
  send?: boolean;
  title?: string;
}

export interface ChatSendMessageParams {
  text: string;
  target?: ChatTarget;
  openPanel?: boolean;
}

export type ChatCompleteResponseFormat = 'text' | 'json';

export type ChatCompleteFinishReason = 'completed' | 'timeout' | 'aborted' | 'failed';

/** Headless AI invocation — structured business payload in `context`. */
export interface ChatCompleteParams {
  prompt: string;
  context?: unknown;
  agentId?: string;
  skillSlugs?: string[];
  responseFormat?: ChatCompleteResponseFormat;
  /** Reuse for multi-turn; omitted means a fresh single-shot session. */
  conversationId?: string;
  /** Agent run budget; defaults to {@link BRIDGE_AI_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface ChatCompleteResult {
  requestId: string;
  runId: string | null;
  text: string;
  /** Present when `responseFormat: 'json'` and parsing succeeded. */
  parsed?: unknown;
  /** Why JSON parsing failed; raw output remains in `text`. */
  parseError?: string;
  finishReason: ChatCompleteFinishReason;
}

export interface ChatCancelParams {
  requestId: string;
}

export interface ChatCancelResult {
  ok: boolean;
}

/** Recommended file reference shape inside `ChatCompleteParams.context`. */
export interface BridgeAiFileAttachmentRef {
  name: string;
  url: string;
  mimeType?: string;
  size?: number;
}

/** Small-file Base64 payload inside `context` (mind {@link BRIDGE_AI_MAX_CONTEXT_BYTES}). */
export interface BridgeAiFileAttachmentBase64 {
  name: string;
  mimeType?: string;
  encoding: 'base64';
  data: string;
}

export interface AppGetInfoResult {
  appId: string | null;
  trustTier: string;
  origin: string | null;
  runtimeId: string | null;
}

export interface BridgeSubscribeResult {
  subscribed: string[];
  added?: string[];
  denied?: string[];
}

export interface StoClawBridgeNative {
  getVersion?: () => string;
  call: (method: string, params?: unknown, options?: CallOptions) => Promise<unknown>;
  invoke?: (method: string, params?: unknown, options?: CallOptions) => Promise<unknown>;
  on: (event: string, handler: (payload: unknown) => void) => () => void;
  off?: (event: string, handler: (payload: unknown) => void) => void;
  getCapabilities?: () => Promise<string[]>;
}

declare global {
  interface Window {
    stoClaw?: StoClawBridgeNative;
    __STOCLAW_BRIDGE_INIT__?: {
      sessionId: string;
      sessionToken: string;
      appId: string | null;
      capabilities: string[];
    };
  }
}
