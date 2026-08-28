import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSclawBrowserChatSessionKeyForApp } from '@/lib/sclaw-browser-chat-session';
import {
  isQuoteEmbedContextForRuntime,
  resolveEmbedQuoteSkillInjection,
} from '@/lib/resolve-embed-quote-skill';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { QUOTE_ASSISTANT_SKILL_SLUG } from '../../shared/quote-embed-app';

vi.mock('@/lib/resolve-embed-runtime-for-chat-send', () => ({
  resolveEmbedRuntimeForChatSend: vi.fn(),
}));

const { resolveEmbedRuntimeForChatSend } = await import('@/lib/resolve-embed-runtime-for-chat-send');

describe('resolve-embed-quote-skill', () => {
  beforeEach(() => {
    vi.mocked(resolveEmbedRuntimeForChatSend).mockReset();
    useAppPlazaShellStore.setState({
      browserTabs: [],
      activeTabId: 'home',
      routeActive: true,
    } as Partial<ReturnType<typeof useAppPlazaShellStore.getState>>);
  });

  it('injects quote-assistant for embed session on quotation page', async () => {
    const sessionKey = createSclawBrowserChatSessionKeyForApp('customer-quote');
    useAppPlazaShellStore.setState({
      browserTabs: [{
        id: 'tab-1',
        url: 'https://wd-vip.sto.cn/claw-quotationNew?useStoToken=1',
        title: '客户报价',
        appId: 'customer-quote',
        status: 'live',
        embedRuntimeId: 'br-quote',
        chatSessionKey: sessionKey,
        chatPanelOpen: true,
      } as never],
    });
    vi.mocked(resolveEmbedRuntimeForChatSend).mockResolvedValue({
      runtimeId: 'br-quote',
      appTitle: '客户报价',
      fallbackUrl: 'https://wd-vip.sto.cn/claw-quotationNew?useStoToken=1',
    });

    const injected = await resolveEmbedQuoteSkillInjection(sessionKey, []);
    expect(injected).toHaveLength(1);
    expect(injected[0].slug).toBe(QUOTE_ASSISTANT_SKILL_SLUG);
  });

  it('does not inject when skill already present', async () => {
    const sessionKey = createSclawBrowserChatSessionKeyForApp('customer-quote');
    const existing = [{ slug: QUOTE_ASSISTANT_SKILL_SLUG, title: '报价助手' }];
    const injected = await resolveEmbedQuoteSkillInjection(sessionKey, existing);
    expect(injected).toBe(existing);
    expect(resolveEmbedRuntimeForChatSend).not.toHaveBeenCalled();
  });

  it('detects quote context from customer-quote app id', () => {
    useAppPlazaShellStore.setState({
      browserTabs: [{
        id: 'tab-1',
        url: 'https://wd-vip.sto.cn/claw-quotationNew?useStoToken=1',
        title: '客户报价',
        appId: 'customer-quote',
        status: 'live',
        embedRuntimeId: 'br-quote',
      } as never],
    });
    expect(isQuoteEmbedContextForRuntime('br-quote')).toBe(true);
  });
});
