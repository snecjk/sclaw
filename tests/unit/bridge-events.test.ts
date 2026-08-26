import { describe, expect, it } from 'vitest';
import {
  BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH,
  isBridgeEventAllowed,
  isValidBridgeEventName,
  matchBridgeEventPattern,
  resolveAllowedBridgeEventPatterns,
} from '../../shared/jsbridge/bridge-events';
import { resolveTrustPolicy } from '../../shared/jsbridge/trust-policy';
import {
  subscribeBridgeEvents,
  unsubscribeBridgeEvents,
} from '../../electron/main/services/jsbridge/handlers/bridge-events';
import type { BridgeSession } from '../../electron/main/services/jsbridge/session-registry';

function makeSession(appId = 'customer-quote'): BridgeSession {
  const trustPolicy = resolveTrustPolicy({ appId, bound: true });
  return {
    sessionId: 'sess-1',
    runtimeId: 'rt-1',
    webContentsId: 1,
    containerKind: 'webview',
    containerRef: 'rt-1',
    trustPolicy,
    bindOrigin: 'https://wd-vip-test.sto.cn',
    currentOrigin: 'https://wd-vip-test.sto.cn',
    sessionToken: 'token',
    grantedCapabilities: new Set(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    destroyed: false,
    invokeCount: 0,
    rateWindowStart: Date.now(),
    navigationGuardInstalled: false,
    eventSubscriptions: new Set(),
  };
}

describe('bridge-events', () => {
  it('validates event names and patterns', () => {
    expect(isValidBridgeEventName('quote:preview-refresh')).toBe(true);
    expect(isValidBridgeEventName('Quote:Bad')).toBe(false);
    expect(matchBridgeEventPattern('quote:*', BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH)).toBe(true);
    expect(matchBridgeEventPattern('quote:*', 'chat:done')).toBe(false);
  });

  it('allows quote events for catalog apps by default', () => {
    const patterns = resolveAllowedBridgeEventPatterns(resolveTrustPolicy({
      appId: 'customer-quote',
      bound: true,
    }));
    expect(isBridgeEventAllowed(BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH, patterns)).toBe(true);
  });

  it('subscribe and unsubscribe update session registry', () => {
    const session = makeSession();
    const { subscribed, denied } = subscribeBridgeEvents(session, [
      BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH,
      'chat:unknown',
    ]);
    expect(subscribed).toEqual([BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH]);
    expect(denied).toEqual(['chat:unknown']);
    expect(session.eventSubscriptions.has(BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH)).toBe(true);

    unsubscribeBridgeEvents(session, [BRIDGE_EVENT_QUOTE_PREVIEW_REFRESH]);
    expect(session.eventSubscriptions.size).toBe(0);
  });
});
