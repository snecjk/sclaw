import { toast } from 'sonner';
import type { BridgeRequest, BridgeResponse } from '../../../shared/jsbridge/protocol';
import { isBridgeRequest } from '../../../shared/jsbridge/protocol';
import { grantJsBridgeCapability, invokeJsBridge } from '@/lib/jsbridge/host-api';
import { resolveJsBridgeResponse } from '@/lib/jsbridge/execute-host-action';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';

type EmbedWebviewElement = HTMLElement & {
  getWebContentsId?: () => number;
  send?: (channel: string, ...args: unknown[]) => void;
};

async function forwardToGuest(webview: EmbedWebviewElement, response: BridgeResponse): Promise<void> {
  try {
    webview.send?.('jsbridge:response', response);
  } catch {
    // guest may be navigating
  }
}

async function maybeGrantConsent(input: {
  response: BridgeResponse;
  sessionId: string;
  webview: EmbedWebviewElement;
  request: BridgeRequest;
  webContentsId: number;
}): Promise<BridgeResponse> {
  if (input.response.ok || input.response.error?.code !== 'USER_CONSENT_REQUIRED') {
    return input.response;
  }
  const capability = input.response.error?.details?.capability;
  const appId = input.response.error?.details?.appId;
  if (typeof capability !== 'string' || typeof appId !== 'string') {
    return input.response;
  }

  const approved = window.confirm(
    `应用「${appId}」请求权限「${capability}」，是否允许？`,
  );
  if (!approved) {
    return {
      ...input.response,
      error: {
        code: 'USER_CONSENT_DENIED',
        message: 'User denied capability consent',
        details: input.response.error?.details,
      },
    };
  }

  await grantJsBridgeCapability({
    sessionId: input.sessionId,
    appId,
    capability,
  });
  let response = await invokeJsBridge({
    request: input.request,
    webContentsId: input.webContentsId,
  });
  response = await resolveJsBridgeResponse(input.request, response);
  return response;
}

export async function handleJsBridgeWebviewRequest(input: {
  webview: EmbedWebviewElement;
  envelope: unknown;
}): Promise<void> {
  if (!isBridgeRequest(input.envelope)) return;
  const webContentsId = input.webview.getWebContentsId?.();
  if (!webContentsId) return;

  let response = await invokeJsBridge({
    request: input.envelope,
    webContentsId,
  });
  response = await maybeGrantConsent({
    response,
    sessionId: input.envelope.sessionId,
    webview: input.webview,
    request: input.envelope,
    webContentsId,
  });
  response = await resolveJsBridgeResponse(input.envelope, response);
  await forwardToGuest(input.webview, response);
}

export function installJsBridgeHostListeners(): () => void {
  if (!window.electron) return () => {};

  const unsubOpenTab = window.electron.ipcRenderer.on(
    'jsbridge:open-tab',
    (payload: unknown) => {
      const data = payload as { url?: string; title?: string };
      const url = typeof data?.url === 'string' ? data.url.trim() : '';
      if (!url) return;
      useAppPlazaShellStore.getState().openOrFocusBrowserTab({
        url,
        title: typeof data?.title === 'string' ? data.title : undefined,
      });
    },
  );

  const unsubCloseTab = window.electron.ipcRenderer.on(
    'jsbridge:close-tab',
    (payload: unknown) => {
      const data = payload as { runtimeId?: string };
      const runtimeId = typeof data?.runtimeId === 'string' ? data.runtimeId : '';
      if (!runtimeId) return;
      const tab = useAppPlazaShellStore.getState().browserTabs.find(
        (entry) => entry.embedRuntimeId === runtimeId,
      );
      if (tab) {
        useAppPlazaShellStore.getState().closeBrowserTab(tab.id);
      }
    },
  );

  const unsubToast = window.electron.ipcRenderer.on(
    'jsbridge:toast',
    (payload: unknown) => {
      const data = payload as { message?: string; level?: string };
      const message = typeof data?.message === 'string' ? data.message : '';
      if (!message) return;
      if (data.level === 'error') toast.error(message);
      else if (data.level === 'warning') toast.warning(message);
      else toast(message);
    },
  );

  return () => {
    unsubOpenTab?.();
    unsubCloseTab?.();
    unsubToast?.();
  };
}

export function pushJsBridgeInit(
  webview: EmbedWebviewElement,
  bootstrap: import('../../../shared/jsbridge/protocol').BridgeBootstrap,
): void {
  try {
    webview.send?.('jsbridge:init', bootstrap);
  } catch {
    // ignore
  }
}
