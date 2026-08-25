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
  | 'BRIDGE_UNAVAILABLE';

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

export interface ChatFillComposerParams {
  text: string;
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

export interface AppGetInfoResult {
  appId: string | null;
  trustTier: string;
  origin: string | null;
  runtimeId: string | null;
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
