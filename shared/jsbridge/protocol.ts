/** stoclaw-bridge/v1 — shared protocol types for Guest ↔ Host ↔ Main. */

export const JSBRIDGE_PROTOCOL = 'stoclaw-bridge/v1' as const;
export const JSBRIDGE_VERSION = '1.0.0';

export type BridgeMessageType = 'request' | 'response' | 'event';

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
  | 'REPLAY_DETECTED';

export interface BridgeError {
  code: BridgeErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface BridgeEnvelopeBase {
  protocol: typeof JSBRIDGE_PROTOCOL;
  version: typeof JSBRIDGE_VERSION;
}

export interface BridgeRequest extends BridgeEnvelopeBase {
  type: 'request';
  id: string;
  sessionId: string;
  method: string;
  params?: unknown;
  timestamp: number;
  userGesture?: boolean;
}

export interface BridgeResponse extends BridgeEnvelopeBase {
  type: 'response';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: BridgeError;
}

export interface BridgeEvent extends BridgeEnvelopeBase {
  type: 'event';
  sessionId: string;
  name: string;
  payload?: unknown;
  timestamp: number;
}

export interface BridgeBootstrap {
  protocol: typeof JSBRIDGE_PROTOCOL;
  version: typeof JSBRIDGE_VERSION;
  sessionId: string;
  sessionToken: string;
  appId: string | null;
  capabilities: string[];
}

export function isBridgeRequest(value: unknown): value is BridgeRequest {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    data.protocol === JSBRIDGE_PROTOCOL
    && data.type === 'request'
    && typeof data.id === 'string'
    && typeof data.sessionId === 'string'
    && typeof data.method === 'string'
    && typeof data.timestamp === 'number'
  );
}

export function createBridgeError(
  code: BridgeErrorCode,
  message: string,
  details?: Record<string, unknown>,
): BridgeError {
  return details ? { code, message, details } : { code, message };
}
