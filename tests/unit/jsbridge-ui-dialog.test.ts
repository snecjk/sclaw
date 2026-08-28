import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  webContents: {
    fromId: () => ({
      isDestroyed: () => false,
      getURL: () => 'https://wd-vip-test.sto.cn/sclaw/clawQuotation',
      on: vi.fn(),
      send: vi.fn(),
    }),
  },
}));

import { JSBRIDGE_HOST_ACTION_MARKER } from '../../shared/jsbridge/host-actions';
import { JSBRIDGE_PROTOCOL, JSBRIDGE_VERSION, type BridgeRequest } from '../../shared/jsbridge/protocol';
import { createBridgeSession } from '../../electron/main/services/jsbridge/session-registry';
import { handleUiOpenDrawer } from '../../electron/main/services/jsbridge/handlers/ui-dialog';

describe('handleUiOpenDrawer', () => {
  it('returns host action with bridge session runtimeId', async () => {
    const session = createBridgeSession({
      runtimeId: 'rt-open-drawer',
      webContentsId: 301,
      pageUrl: 'https://wd-vip-test.sto.cn/sclaw/clawQuotation',
      appId: 'vip',
      bound: true,
    });
    expect(session).toBeTruthy();

    const request: BridgeRequest = {
      protocol: JSBRIDGE_PROTOCOL,
      version: JSBRIDGE_VERSION,
      type: 'request',
      id: 'req-open-drawer',
      sessionId: session!.sessionId,
      method: 'ui.openDrawer',
      params: { kind: 'chat' },
      timestamp: Date.now(),
    };

    const envelope = await handleUiOpenDrawer({ session: session!, request });
    expect(envelope[JSBRIDGE_HOST_ACTION_MARKER]).toBe(true);
    expect(envelope.action).toEqual({
      type: 'ui.openDrawer',
      kind: 'chat',
      runtimeId: 'rt-open-drawer',
    });
  });
});
