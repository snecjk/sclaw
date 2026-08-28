import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BridgeRequest, BridgeResponse } from '../../../../shared/jsbridge/protocol';
import { createBridgeError, JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION } from '../../../../shared/jsbridge/protocol';
import { JSBRIDGE_ORIGIN_POLICY } from '../../../../shared/jsbridge/config';

let masterSecret: Buffer | null = null;

function getMasterSecret(): Buffer {
  if (!masterSecret) {
    masterSecret = randomBytes(32);
  }
  return masterSecret;
}

export function issueSessionToken(input: {
  sessionId: string;
  webContentsId: number;
  bindOrigin: string;
  expiresAt: number;
}): string {
  const payload = `${input.sessionId}:${input.webContentsId}:${input.bindOrigin}:${input.expiresAt}`;
  return createHmac('sha256', getMasterSecret()).update(payload).digest('base64url');
}

export function verifySessionToken(input: {
  sessionId: string;
  webContentsId: number;
  bindOrigin: string;
  expiresAt: number;
  sessionToken: string;
}): boolean {
  const expected = issueSessionToken(input);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(input.sessionToken);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function validateRequestTimestamp(timestamp: number): boolean {
  const skew = JSBRIDGE_ORIGIN_POLICY.requestTimestampSkewMs;
  const now = Date.now();
  return timestamp >= now - skew && timestamp <= now + skew;
}

export class ReplayGuard {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  consume(requestId: string): boolean {
    if (this.seen.has(requestId)) return false;
    this.seen.add(requestId);
    this.order.push(requestId);
    while (this.order.length > JSBRIDGE_ORIGIN_POLICY.replayCacheSize) {
      const oldest = this.order.shift();
      if (oldest) this.seen.delete(oldest);
    }
    return true;
  }
}

export function buildBridgeResponse(request: BridgeRequest, result: {
  ok: boolean;
  data?: unknown;
  error?: BridgeResponse['error'];
}): BridgeResponse {
  return {
    protocol: JSBRIDGE_PROTOCOL,
    version: JSBRIDGE_VERSION,
    type: 'response',
    id: request.id,
    ok: result.ok,
    data: result.data,
    error: result.error,
  };
}

export function bridgeFailure(
  request: BridgeRequest,
  code: BridgeResponse['error'] extends infer E ? E extends { code: infer C } ? C : never : never,
  message: string,
  details?: Record<string, unknown>,
): BridgeResponse {
  return buildBridgeResponse(request, {
    ok: false,
    error: createBridgeError(code as Parameters<typeof createBridgeError>[0], message, details),
  });
}

export function newSessionId(): string {
  return randomUUID();
}
