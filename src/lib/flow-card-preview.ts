/**
 * Open / re-open / refresh flow-card preview:
 * - Main chat session → preview panel
 * - App Plaza embed chat → business webview (force navigate; never plain reload)
 */
import { buildVipClawQuotationUrl } from '../../shared/vip-claw-quotation-url';
import type { FlowCardContentBlock } from '../../shared/flow-card-protocol';
import type { QuoteBridgeNotifyKind } from '../../shared/quote-bridge-channels';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { emitQuoteFlowCardBridgeEvents } from '@/lib/quote-bridge-emit';
import { openChatBrowserPreview } from '@/stores/chat-browser-preview';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useChatStore } from '@/stores/chat';

export type FlowCardPreviewMode = 'open' | 'refresh';

function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Prefer explicit previewUrl; else build clawQuotation from ossKey for current env. */
export function resolveFlowCardPreviewUrl(card: FlowCardContentBlock): string | null {
  const direct = readString(card.data, 'previewUrl');
  if (direct && /^https?:\/\//i.test(direct)) return direct;
  const ossKey = readString(card.data, 'ossKey');
  if (ossKey) return buildVipClawQuotationUrl(ossKey);
  return null;
}

export function resolveFlowCardPreviewMode(card: FlowCardContentBlock): FlowCardPreviewMode {
  const raw = readString(card.data, 'previewMode');
  if (raw === 'refresh') return 'refresh';
  if (card.phase === 'editing' || card.phase === 'submitted') return 'refresh';
  return 'open';
}

export function openFlowCardPreview(input: {
  url: string;
  title?: string;
  mode?: FlowCardPreviewMode;
  sessionKey?: string;
}): void {
  const url = input.url.trim();
  if (!url) return;
  const sessionKey = input.sessionKey ?? useChatStore.getState().currentSessionKey;
  const title = input.title?.trim() || '报价确认';

  if (isSclawBrowserEmbedChatSessionKey(sessionKey)) {
    const shell = useAppPlazaShellStore.getState();
    const tab = shell.browserTabs.find(
      (entry) => entry.chatSessionKey === sessionKey && entry.status === 'live',
    ) ?? shell.browserTabs.find((entry) => entry.id === shell.activeTabId && entry.status === 'live');
    if (tab) {
      shell.navigateBrowserTabUrl(tab.id, url, { force: true });
      return;
    }
  }

  openChatBrowserPreview({ sessionKey, url, title, force: true });
}

function resolveEmbedRuntimeId(sessionKey: string): string | null {
  if (!isSclawBrowserEmbedChatSessionKey(sessionKey)) return null;
  const shell = useAppPlazaShellStore.getState();
  const tab = shell.browserTabs.find(
    (entry) => entry.chatSessionKey === sessionKey && entry.status === 'live',
  ) ?? shell.browserTabs.find((entry) => entry.id === shell.activeTabId && entry.status === 'live');
  return tab?.embedRuntimeId ?? null;
}

/** Sync preview — optionally navigate business page; always emit `quote:event` when requested. */
export function syncFlowCardPreview(
  card: FlowCardContentBlock,
  sessionKey?: string,
  notify?: QuoteBridgeNotifyKind,
  options?: { navigate?: boolean },
): void {
  const key = sessionKey ?? useChatStore.getState().currentSessionKey;
  const url = resolveFlowCardPreviewUrl(card);
  const mode = resolveFlowCardPreviewMode(card);
  if (url && options?.navigate) {
    openFlowCardPreview({
      url,
      title: readString(card.data, 'previewTitle') || '报价确认',
      mode,
      sessionKey: key,
    });
  }
  if (!notify) return;
  const runtimeId = resolveEmbedRuntimeId(key);
  if (runtimeId) {
    emitQuoteFlowCardBridgeEvents(card, runtimeId, url, mode, notify);
  }
}
