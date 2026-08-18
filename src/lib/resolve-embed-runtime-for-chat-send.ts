/**
 * Resolve embed browser runtime when preparing App Plaza / drawer chat send context.
 */
import { hostApiFetch } from '@/lib/host-api';
import type { SclawEmbedBrowserRuntimeMeta } from '../../shared/sclaw-embed-browser-runtime';

export interface EmbedRuntimeForChatSend {
  runtimeId: string;
  appTitle: string;
  fallbackUrl: string;
}

export async function resolveEmbedRuntimeForChatSend(
  sessionKey: string,
): Promise<EmbedRuntimeForChatSend | null> {
  const { useAppPlazaShellStore } = await import('@/stores/app-plaza-shell');
  const plazaTab = useAppPlazaShellStore.getState().browserTabs.find(
    (tab) => tab.chatSessionKey === sessionKey && tab.embedRuntimeId && tab.status === 'live',
  );
  if (plazaTab?.embedRuntimeId) {
    return {
      runtimeId: plazaTab.embedRuntimeId,
      appTitle: plazaTab.title,
      fallbackUrl: plazaTab.currentPageUrl ?? plazaTab.url,
    };
  }

  const { useSclawBrowserOverlayStore } = await import('@/stores/sclaw-browser-overlay');
  const overlay = useSclawBrowserOverlayStore.getState();
  if (overlay.embedRuntimeId && overlay.session) {
    return {
      runtimeId: overlay.embedRuntimeId,
      appTitle: overlay.session.title,
      fallbackUrl: overlay.session.url,
    };
  }

  try {
    const result = await hostApiFetch<{ success?: boolean; meta?: SclawEmbedBrowserRuntimeMeta }>(
      `/api/sclaw-browser/by-session/${encodeURIComponent(sessionKey)}`,
    );
    if (result?.success && result.meta?.runtimeId) {
      const meta = result.meta;
      return {
        runtimeId: meta.runtimeId,
        appTitle: meta.appTitle,
        fallbackUrl: meta.pageUrl?.trim() || meta.initialUrl,
      };
    }
  } catch {
    // Non-blocking.
  }

  return null;
}
