/**
 * Build hidden chat context from embed browser runtime (page snapshot + tool routing hints).
 */
import type { SclawBrowserEmbedContextBlock } from '@/lib/sclaw-browser-embed-context';
import { captureSclawBrowserPage, getSclawBrowserNetworkLog } from '@/lib/sclaw-browser-host-api';

export async function buildSclawBrowserEmbedContextForSend(input: {
  runtimeId: string;
  appTitle: string;
  fallbackUrl: string;
}): Promise<SclawBrowserEmbedContextBlock> {
  const snapshot = await captureSclawBrowserPage(input.runtimeId);
  const recentNetwork = await getSclawBrowserNetworkLog(input.runtimeId, Date.now() - 60_000);

  return {
    embedRuntimeId: input.runtimeId,
    appTitle: input.appTitle,
    pageUrl: snapshot?.pageUrl ?? input.fallbackUrl,
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
