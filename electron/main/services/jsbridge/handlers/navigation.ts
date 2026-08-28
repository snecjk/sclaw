import { BrowserWindow, webContents } from 'electron';
import { createHostActionEnvelope } from '../../../../../shared/jsbridge/host-actions';
import { isStoCnOrigin } from '../../../../../shared/jsbridge/origin-policy';
import type { BridgeHandlerFn } from './types';

function resolveHostWebContents(guestWebContentsId: number) {
  const guest = webContents.fromId(guestWebContentsId);
  const host = guest && !guest.isDestroyed()
    ? (guest as Electron.WebContents & { hostWebContents?: Electron.WebContents | null }).hostWebContents
    : null;
  if (host && !host.isDestroyed()) return host;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused.webContents;
  const candidate = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  return candidate?.webContents ?? null;
}

export const handleNavOpenTab: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as { url?: string; title?: string } | undefined;
  const url = typeof params?.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw Object.assign(new Error('url is required'), { code: 'INVALID_PARAMS' });
  }
  if (!isStoCnOrigin(url)) {
    throw Object.assign(new Error('Only *.sto.cn URLs can be opened'), { code: 'ORIGIN_DENIED' });
  }
  const host = resolveHostWebContents(session.webContentsId);
  if (!host || host.isDestroyed()) {
    throw Object.assign(new Error('Host window unavailable'), { code: 'INTERNAL_ERROR' });
  }
  host.send('jsbridge:open-tab', {
    url,
    title: typeof params?.title === 'string' ? params.title : undefined,
    runtimeId: session.runtimeId ?? undefined,
  });
  return { ok: true };
};

export const handleNavOpenExternal: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as { url?: string } | undefined;
  const url = typeof params?.url === 'string' ? params.url.trim() : '';
  if (!url) {
    throw Object.assign(new Error('url is required'), { code: 'INVALID_PARAMS' });
  }
  const { shell } = await import('electron');
  await shell.openExternal(url);
  return { ok: true };
};

export const handleNavGoBack: BridgeHandlerFn = async ({ session }) => {
  const wc = webContents.fromId(session.webContentsId);
  if (!wc || wc.isDestroyed()) {
    throw Object.assign(new Error('Webview unavailable'), { code: 'INTERNAL_ERROR' });
  }
  if (wc.canGoBack()) wc.goBack();
  return { ok: true, canGoBack: wc.canGoBack() };
};

export const handleNavReload: BridgeHandlerFn = async ({ session }) => {
  const wc = webContents.fromId(session.webContentsId);
  if (!wc || wc.isDestroyed()) {
    throw Object.assign(new Error('Webview unavailable'), { code: 'INTERNAL_ERROR' });
  }
  wc.reload();
  return { ok: true };
};

export const handleNavCloseSelf: BridgeHandlerFn = async ({ session }) => {
  const host = resolveHostWebContents(session.webContentsId);
  if (!host || host.isDestroyed()) {
    throw Object.assign(new Error('Host window unavailable'), { code: 'INTERNAL_ERROR' });
  }
  host.send('jsbridge:close-tab', { runtimeId: session.runtimeId ?? undefined });
  return { ok: true };
};

export const handleNavOpenApp: BridgeHandlerFn = async ({ request }) => {
  const params = request.params as { appId?: string; title?: string } | undefined;
  const appId = typeof params?.appId === 'string' ? params.appId.trim() : '';
  if (!appId) {
    throw Object.assign(new Error('appId is required'), { code: 'INVALID_PARAMS' });
  }
  return createHostActionEnvelope({
    type: 'nav.jump',
    jumpType: 'app',
    appId,
    title: typeof params?.title === 'string' ? params.title.trim() : undefined,
  });
};

export const handleNavJump: BridgeHandlerFn = async ({ session, request }) => {
  const params = request.params as {
    type?: string;
    url?: string;
    appId?: string;
    route?: string;
    title?: string;
  } | undefined;
  const jumpType = typeof params?.type === 'string' ? params.type.trim() : '';
  if (!jumpType) {
    throw Object.assign(new Error('type is required'), { code: 'INVALID_PARAMS' });
  }

  if (jumpType === 'webview') {
    const url = typeof params?.url === 'string' ? params.url.trim() : '';
    if (!url) throw Object.assign(new Error('url is required for webview jump'), { code: 'INVALID_PARAMS' });
    if (!isStoCnOrigin(url)) {
      throw Object.assign(new Error('Only *.sto.cn URLs can be opened in webview'), { code: 'ORIGIN_DENIED' });
    }
    const host = resolveHostWebContents(session.webContentsId);
    if (!host || host.isDestroyed()) {
      throw Object.assign(new Error('Host window unavailable'), { code: 'INTERNAL_ERROR' });
    }
    host.send('jsbridge:open-tab', {
      url,
      title: typeof params?.title === 'string' ? params.title : undefined,
      runtimeId: session.runtimeId ?? undefined,
    });
    return { ok: true, type: 'webview', url };
  }

  if (jumpType === 'external') {
    const url = typeof params?.url === 'string' ? params.url.trim() : '';
    if (!url) throw Object.assign(new Error('url is required for external jump'), { code: 'INVALID_PARAMS' });
    const { shell } = await import('electron');
    await shell.openExternal(url);
    return { ok: true, type: 'external', url };
  }

  if (jumpType === 'app') {
    const appId = typeof params?.appId === 'string' ? params.appId.trim() : '';
    if (!appId) throw Object.assign(new Error('appId is required for app jump'), { code: 'INVALID_PARAMS' });
    return createHostActionEnvelope({
      type: 'nav.jump',
      jumpType: 'app',
      appId,
      title: typeof params?.title === 'string' ? params.title.trim() : undefined,
    });
  }

  if (jumpType === 'route') {
    const route = typeof params?.route === 'string' ? params.route.trim() : '';
    if (!route) throw Object.assign(new Error('route is required for route jump'), { code: 'INVALID_PARAMS' });
    return createHostActionEnvelope({
      type: 'nav.jump',
      jumpType: 'route',
      route,
    });
  }

  throw Object.assign(new Error(`Unsupported jump type: ${jumpType}`), { code: 'INVALID_PARAMS' });
};
