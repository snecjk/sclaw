import { describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/main/services/jsbridge/consent-store', () => ({
  hasBridgeConsent: () => false,
  grantBridgeConsent: vi.fn(),
  revokeBridgeAppConsents: vi.fn(),
  listBridgeConsents: () => [],
  revokeBridgeConsent: vi.fn(),
}));

vi.mock('electron', () => ({
  webContents: {
    fromId: () => ({
      isDestroyed: () => false,
      getURL: () => 'https://policy.sto.cn/page',
      on: vi.fn(),
      send: vi.fn(),
    }),
  },
}));

import type { BridgeRequest } from '../../shared/jsbridge/protocol';
import { JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION } from '../../shared/jsbridge/protocol';
import { createBridgeSession, destroyBridgeSession } from '../../electron/main/services/jsbridge/session-registry';
import { dispatchBridgeInvoke } from '../../electron/main/services/jsbridge/dispatcher';

describe('jsbridge dispatcher', () => {
  function makeRequest(sessionId: string, method: string): BridgeRequest {
    return {
      protocol: JSBRIDGE_PROTOCOL,
      version: JSBRIDGE_VERSION,
      type: 'request',
      id: crypto.randomUUID(),
      sessionId,
      method,
      timestamp: Date.now(),
    };
  }

  it('creates session only for *.sto.cn pages', () => {
    const ok = createBridgeSession({
      runtimeId: 'rt-1',
      webContentsId: 101,
      pageUrl: 'https://policy.sto.cn/home',
      appId: 'policy',
      bound: true,
    });
    expect(ok?.sessionId).toBeTruthy();

    const denied = createBridgeSession({
      runtimeId: 'rt-2',
      webContentsId: 102,
      pageUrl: 'https://example.com/home',
      appId: 'x',
      bound: false,
    });
    expect(denied).toBeNull();

    const blank = createBridgeSession({
      runtimeId: 'rt-blank',
      webContentsId: 103,
      pageUrl: 'about:blank',
      appId: 'vip',
      bound: true,
    });
    expect(blank).toBeNull();
  });

  it('handles bridge.ping for valid session', async () => {
    const session = createBridgeSession({
      runtimeId: 'rt-ping',
      webContentsId: 201,
      pageUrl: 'https://wd-vip.sto.cn/',
      appId: 'vip',
      bound: true,
    });
    expect(session).toBeTruthy();
    const response = await dispatchBridgeInvoke({
      request: makeRequest(session!.sessionId, 'bridge.ping'),
      webContentsId: 201,
      sessionToken: session!.sessionToken,
    });
    expect(response.ok).toBe(true);
    destroyBridgeSession(session!.sessionId);
  });

  it('denies unknown methods', async () => {
    const session = createBridgeSession({
      runtimeId: 'rt-deny',
      webContentsId: 301,
      pageUrl: 'https://policy.sto.cn/',
      appId: 'policy',
      bound: false,
    });
    expect(session).toBeTruthy();
    const response = await dispatchBridgeInvoke({
      request: makeRequest(session!.sessionId, 'browser.evaluate'),
      webContentsId: 301,
      sessionToken: session!.sessionToken,
    });
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('METHOD_NOT_FOUND');
    destroyBridgeSession(session!.sessionId);
  });

  it('registers bridge event subscriptions for catalog apps', async () => {
    const session = createBridgeSession({
      runtimeId: 'rt-sub',
      webContentsId: 401,
      pageUrl: 'https://wd-vip-test.sto.cn/sclaw/clawQuotation',
      appId: 'customer-quote',
      bound: true,
    });
    expect(session).toBeTruthy();

    const subscribe = await dispatchBridgeInvoke({
      request: {
        ...makeRequest(session!.sessionId, 'bridge.subscribe'),
        params: { events: ['quote:event'] },
      },
      webContentsId: 401,
      sessionToken: session!.sessionToken,
    });
    expect(subscribe.ok).toBe(true);
    expect((subscribe.data as { subscribed?: string[] })?.subscribed).toContain('quote:event');

    const denied = await dispatchBridgeInvoke({
      request: {
        ...makeRequest(session!.sessionId, 'bridge.subscribe'),
        params: { events: ['chat:not-allowed'] },
      },
      webContentsId: 401,
      sessionToken: session!.sessionToken,
    });
    expect(denied.ok).toBe(false);

    destroyBridgeSession(session!.sessionId);
  });
});
