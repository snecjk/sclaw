import { describe, expect, it } from 'vitest';
import { handleBridgeGetCapabilities } from '../../electron/main/services/jsbridge/handlers/bridge-meta';
import type { BridgeSession } from '../../electron/main/services/jsbridge/session-registry';

function session(partial: Partial<BridgeSession>): BridgeSession {
  return {
    sessionId: 's1',
    runtimeId: null,
    webContentsId: 1,
    containerKind: 'webview',
    containerRef: 'ref',
    trustPolicy: {
      appId: 'demo',
      trustTier: 'internal',
      allowedOrigins: ['https://demo.sto.cn'],
      capabilities: [],
      consentCapabilities: [],
      ai: { enabled: false },
    },
    bindOrigin: 'https://demo.sto.cn',
    currentOrigin: 'https://demo.sto.cn',
    sessionToken: 'token',
    grantedCapabilities: new Set([
      'bridge.ping',
      'chat.complete',
      'chat.cancel',
      'chat.invokeAgent',
    ]),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    destroyed: false,
    invokeCount: 0,
    rateWindowStart: Date.now(),
    navigationGuardInstalled: false,
    ...partial,
  };
}

describe('handleBridgeGetCapabilities', () => {
  it('hides AI capabilities when profile is disabled', async () => {
    const result = await handleBridgeGetCapabilities({
      session: session({}),
      request: { id: '1' } as never,
    });
    expect(result).toEqual({ capabilities: ['bridge.ping'] });
  });

  it('reports granted AI capabilities when profile is enabled', async () => {
    const enabledSession = session({
      trustPolicy: {
        appId: 'demo',
        trustTier: 'internal',
        allowedOrigins: ['https://demo.sto.cn'],
        capabilities: [],
        consentCapabilities: [],
        ai: { enabled: true },
      },
    });
    const result = await handleBridgeGetCapabilities({
      session: enabledSession,
      request: { id: '1' } as never,
    });
    expect(result).toEqual({
      capabilities: ['bridge.ping', 'chat.complete', 'chat.cancel', 'chat.invokeAgent'],
    });
  });
});
