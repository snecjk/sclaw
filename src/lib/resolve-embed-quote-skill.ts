/**
 * Auto-inject quote-assistant for App Plaza embed chat on quotation pages.
 */
import { isSclawBrowserEmbedChatSessionKey } from '@/lib/sclaw-browser-chat-session';
import { resolveEmbedRuntimeForChatSend } from '@/lib/resolve-embed-runtime-for-chat-send';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import type { SkillMeta } from '@/types/skill-meta';
import {
  QUOTE_ASSISTANT_SKILL_SLUG,
  QUOTE_ASSISTANT_SKILL_TITLE,
  QUOTE_EMBED_APP_ID,
  hasQuoteAssistantSkill,
  isQuoteEmbedPageUrl,
} from '../../shared/quote-embed-app';

export function resolveQuotePageUrlForEmbedRuntime(embedRuntimeId: string): string {
  const plazaTab = useAppPlazaShellStore.getState().browserTabs.find(
    (tab) => tab.embedRuntimeId === embedRuntimeId,
  );
  if (plazaTab) {
    return plazaTab.currentPageUrl ?? plazaTab.url;
  }

  const overlay = useSclawBrowserOverlayStore.getState();
  if (overlay.embedRuntimeId === embedRuntimeId && overlay.session) {
    return overlay.session.url;
  }

  return '';
}

export function isQuoteEmbedContextForRuntime(embedRuntimeId: string): boolean {
  const plazaTab = useAppPlazaShellStore.getState().browserTabs.find(
    (tab) => tab.embedRuntimeId === embedRuntimeId,
  );
  if (plazaTab?.appId === QUOTE_EMBED_APP_ID) return true;
  const pageUrl = plazaTab
    ? plazaTab.currentPageUrl ?? plazaTab.url
    : resolveQuotePageUrlForEmbedRuntime(embedRuntimeId);
  return isQuoteEmbedPageUrl(pageUrl);
}

export async function resolveEmbedQuoteSkillInjection(
  sessionKey: string,
  skillMetas: SkillMeta[],
): Promise<SkillMeta[]> {
  if (!isSclawBrowserEmbedChatSessionKey(sessionKey)) return skillMetas;
  if (hasQuoteAssistantSkill(skillMetas)) return skillMetas;

  const runtime = await resolveEmbedRuntimeForChatSend(sessionKey);
  if (!runtime) return skillMetas;

  const pageUrl = runtime.fallbackUrl;
  const plazaTab = useAppPlazaShellStore.getState().browserTabs.find(
    (tab) => tab.chatSessionKey === sessionKey,
  );
  const isQuoteContext = isQuoteEmbedPageUrl(pageUrl)
    || plazaTab?.appId === QUOTE_EMBED_APP_ID;

  if (!isQuoteContext) return skillMetas;

  return [
    ...skillMetas,
    { slug: QUOTE_ASSISTANT_SKILL_SLUG, title: QUOTE_ASSISTANT_SKILL_TITLE },
  ];
}
