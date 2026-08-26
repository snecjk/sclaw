/**
 * Open / re-open / refresh flow-card preview:
 * - Main chat session → right browser preview panel
 * - App Plaza embed chat → left webview (force navigate; never plain reload)
 */
import { buildVipClawQuotationUrl } from '../../shared/vip-claw-quotation-url';
import type { FlowCardContentBlock } from '../../shared/flow-card-protocol';
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
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
  // After save/submit, default to re-open (business SPA may have left clawQuotation).
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

/** Sync preview for a flow_card — main right / plaza left. */
export function syncFlowCardPreview(card: FlowCardContentBlock, sessionKey?: string): void {
  const url = resolveFlowCardPreviewUrl(card);
  if (!url) return;
  openFlowCardPreview({
    url,
    title: readString(card.data, 'previewTitle') || '报价确认',
    mode: resolveFlowCardPreviewMode(card),
    sessionKey,
  });
}
