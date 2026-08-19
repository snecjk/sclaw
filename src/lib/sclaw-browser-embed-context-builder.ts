/**
 * Build hidden chat context from embed browser runtime (page snapshot + bridge session).
 */
import { buildSclawEmbedBridgeSessionId } from '../../shared/sclaw-embed-bridge-inject';
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';
import { captureSclawBrowserPage, ensureSclawBrowserBridge, getSclawBrowserNetworkLog } from '@/lib/sclaw-browser-host-api';

export async function buildSclawBrowserEmbedContextForSend(input: {
  runtimeId: string;
  appTitle: string;
  fallbackUrl: string;
}): Promise<SclawBrowserEmbedContextBlock> {
  await ensureSclawBrowserBridge(input.runtimeId);
  const snapshot = await captureSclawBrowserPage(input.runtimeId);
  const recentNetwork = await getSclawBrowserNetworkLog(input.runtimeId, Date.now() - 60_000);
  const bridgeSessionId = buildSclawEmbedBridgeSessionId(input.runtimeId);
  const livePageUrl = snapshot?.pageUrl?.trim() || input.fallbackUrl;

  return {
    embedRuntimeId: input.runtimeId,
    bridgeSessionId,
    appTitle: input.appTitle,
    pageUrl: livePageUrl,
    pageTitle: snapshot?.pageTitle ?? '',
    visibleTextExcerpt: snapshot?.visibleTextExcerpt ?? '',
    capturedAt: snapshot?.capturedAt ?? Date.now(),
    recentNetworkRequests: recentNetwork.slice(-20).map((event) => ({
      method: event.method,
      url: event.url,
      statusCode: event.statusCode,
    })),
  };
}
