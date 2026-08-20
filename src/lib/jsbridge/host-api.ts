import { invokeIpc } from '@/lib/api-client';
import type { BridgeBootstrap, BridgeRequest, BridgeResponse } from '../../../shared/jsbridge/protocol';

export async function getJsBridgeGuestPreloadUrl(): Promise<string | null> {
  if (!window.electron) return null;
  const result = await invokeIpc<{ ok?: boolean; preloadUrl?: string }>('bridge:getGuestPreloadPath');
  return result.preloadUrl ?? null;
}

export async function invokeJsBridge(input: {
  request: BridgeRequest;
  webContentsId: number;
  sessionToken?: string;
}): Promise<BridgeResponse> {
  const result = await invokeIpc<{ ok?: boolean; response?: BridgeResponse }>('bridge:invoke', input);
  if (!result.response) {
    return {
      protocol: 'stoclaw-bridge/v1',
      version: '1.0.0',
      type: 'response',
      id: input.request.id,
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Empty bridge response' },
    };
  }
  return result.response;
}

export async function grantJsBridgeCapability(input: {
  sessionId: string;
  appId: string;
  capability: string;
}): Promise<boolean> {
  const result = await invokeIpc<{ ok?: boolean }>('bridge:grantCapability', input);
  return Boolean(result.ok);
}

export type { BridgeBootstrap, BridgeRequest, BridgeResponse };
