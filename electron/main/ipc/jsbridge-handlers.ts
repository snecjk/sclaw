import { ipcMain } from 'electron';
import type { Capability } from '../../../shared/jsbridge/capabilities';
import { isCapability } from '../../../shared/jsbridge/capabilities';
import { getJsBridgeGuestPreloadPath, getJsBridgeGuestPreloadUrl } from '../../utils/jsbridge-guest-preload-path';
import {
  dispatchBridgeInvoke,
  emitBridgeEvent,
  grantBridgeConsent,
  grantCapabilityToSession,
  listBridgeConsents,
  revokeBridgeAppConsents,
  revokeBridgeConsent,
} from '../services/jsbridge';
import { getAuthState } from '../../utils/auth-store';

export function registerJsBridgeIpcHandlers(): void {
  ipcMain.handle('bridge:getGuestPreloadPath', async () => ({
    ok: true,
    path: getJsBridgeGuestPreloadPath(),
    preloadUrl: getJsBridgeGuestPreloadUrl(),
  }));

  ipcMain.handle('bridge:invoke', async (_, payload: {
    request?: unknown;
    webContentsId?: number;
    sessionToken?: string;
  }) => {
    const webContentsId = typeof payload?.webContentsId === 'number' ? payload.webContentsId : 0;
    if (!webContentsId) {
      return {
        ok: false,
        response: {
          protocol: 'stoclaw-bridge/v1',
          version: '1.0.0',
          type: 'response',
          id: 'invalid',
          ok: false,
          error: { code: 'INVALID_SESSION', message: 'webContentsId required' },
        },
      };
    }
    const response = await dispatchBridgeInvoke({
      request: payload?.request,
      webContentsId,
      sessionToken: typeof payload?.sessionToken === 'string' ? payload.sessionToken : undefined,
    });
    return { ok: true, response };
  });

  ipcMain.handle('bridge:grantCapability', async (_, payload: {
    sessionId?: string;
    appId?: string;
    capability?: string;
  }) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : '';
    const capability = typeof payload?.capability === 'string' ? payload.capability.trim() : '';
    if (!appId || !isCapability(capability)) {
      return { ok: false, error: 'Invalid appId or capability' };
    }

    const auth = await getAuthState();
    if (!auth.isAuthenticated || !auth.user) {
      return { ok: false, error: 'Authentication required' };
    }

    await grantBridgeConsent({
      appId,
      capability: capability as Capability,
      grantedBy: auth.user.id,
    });
    if (sessionId) {
      grantCapabilityToSession(sessionId, capability as Capability);
    }
    return { ok: true };
  });

  ipcMain.handle('bridge:listConsents', async (_, payload: { appId?: string }) => {
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : undefined;
    return { ok: true, consents: await listBridgeConsents(appId) };
  });

  ipcMain.handle('bridge:revokeApp', async (_, payload: { appId?: string }) => {
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : '';
    if (!appId) return { ok: false };
    await revokeBridgeAppConsents(appId);
    return { ok: true };
  });

  ipcMain.handle('bridge:revokeCapability', async (_, payload: {
    appId?: string;
    capability?: string;
  }) => {
    const appId = typeof payload?.appId === 'string' ? payload.appId.trim() : '';
    const capability = typeof payload?.capability === 'string' ? payload.capability.trim() : '';
    if (!appId || !isCapability(capability)) return { ok: false };
    await revokeBridgeConsent(appId, capability as Capability);
    return { ok: true };
  });

  ipcMain.handle('bridge:emitEvent', async (_, payload: {
    runtimeId?: string;
    webContentsId?: number;
    sessionId?: string;
    name?: string;
    eventPayload?: unknown;
  }) => {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (!name) return { ok: false, delivered: false };
    const delivered = emitBridgeEvent({
      runtimeId: typeof payload?.runtimeId === 'string' ? payload.runtimeId : undefined,
      webContentsId: typeof payload?.webContentsId === 'number' ? payload.webContentsId : undefined,
      sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : undefined,
      name,
      payload: payload?.eventPayload,
    });
    return { ok: true, delivered };
  });
}
