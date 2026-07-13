/**
 * Renderer host API for embed browser runtime (IPC bridge).
 */
import { invokeIpc } from '@/lib/api-client';
import type {
  SclawEmbedBrowserNetworkEvent,
  SclawEmbedBrowserPageSnapshot,
  SclawEmbedBrowserRuntimeMeta,
} from '../../shared/sclaw-embed-browser-runtime';

export async function registerSclawBrowserRuntime(input: {
  runtimeId: string;
  appTitle: string;
  initialUrl: string;
}): Promise<{ ok: boolean }> {
  if (!window.electron) return { ok: false };
  return invokeIpc('sclaw-browser:registerRuntime', input);
}

export async function linkSclawBrowserChatSession(input: {
  runtimeId: string;
  chatSessionKey: string;
}): Promise<{ ok: boolean }> {
  if (!window.electron) return { ok: false };
  return invokeIpc('sclaw-browser:linkChatSession', input);
}

export async function bindSclawBrowserWebContents(input: {
  runtimeId: string;
  webContentsId: number;
  pageUrl?: string;
  pageTitle?: string;
}): Promise<{ ok: boolean; meta?: SclawEmbedBrowserRuntimeMeta }> {
  if (!window.electron) return { ok: false };
  return invokeIpc('sclaw-browser:bindWebContents', input);
}

export async function updateSclawBrowserPageState(input: {
  runtimeId: string;
  pageUrl?: string;
  pageTitle?: string;
}): Promise<{ ok: boolean }> {
  if (!window.electron) return { ok: false };
  return invokeIpc('sclaw-browser:updatePageState', input);
}

export async function unregisterSclawBrowserRuntime(runtimeId: string): Promise<{ ok: boolean }> {
  if (!window.electron) return { ok: false };
  return invokeIpc('sclaw-browser:unregisterRuntime', { runtimeId });
}

export async function captureSclawBrowserPage(runtimeId: string): Promise<SclawEmbedBrowserPageSnapshot | null> {
  if (!window.electron) return null;
  const result = await invokeIpc<{ ok: boolean; snapshot?: SclawEmbedBrowserPageSnapshot }>(
    'sclaw-browser:capturePage',
    { runtimeId },
  );
  return result.snapshot ?? null;
}

export async function executeSclawBrowserScript(
  runtimeId: string,
  script: string,
): Promise<unknown> {
  if (!window.electron) {
    throw new Error('Embed browser script execution requires Electron');
  }
  const result = await invokeIpc<{ ok: boolean; value?: unknown }>(
    'sclaw-browser:executeScript',
    { runtimeId, script },
  );
  return result.value;
}

export async function getSclawBrowserNetworkLog(
  runtimeId: string,
  since?: number,
): Promise<SclawEmbedBrowserNetworkEvent[]> {
  if (!window.electron) return [];
  const result = await invokeIpc<{ ok: boolean; events?: SclawEmbedBrowserNetworkEvent[] }>(
    'sclaw-browser:getNetworkLog',
    { runtimeId, since },
  );
  return result.events ?? [];
}
