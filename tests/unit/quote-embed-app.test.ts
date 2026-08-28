import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUOTE_EMBED_COMPOSER_ACTIONS,
  hasQuoteAssistantSkill,
  isQuoteAssistantSkillSlug,
  isQuoteEmbedPageUrl,
  QUOTE_ASSISTANT_SKILL_SLUG,
} from '../../shared/quote-embed-app';

describe('quote-embed-app', () => {
  it('detects VIP clawQuotation confirmation pages', () => {
    expect(isQuoteEmbedPageUrl('https://wd-vip-test.sto.cn/sclaw/clawQuotation?ossKey=a')).toBe(true);
  });

  it('detects quotation workbench and quote-ops-console routes', () => {
    expect(isQuoteEmbedPageUrl('https://wd-vip.sto.cn/claw-quotationNew?useStoToken=1')).toBe(true);
    expect(isQuoteEmbedPageUrl('https://wd-vip.sto.cn/vipLogin#/quote-ops-console')).toBe(true);
  });

  it('does not match unrelated VIP apps', () => {
    expect(isQuoteEmbedPageUrl('https://wd-vip.sto.cn/claw-businessOrganization?useStoToken=1')).toBe(false);
  });

  it('recognizes quote-assistant skill slug', () => {
    expect(isQuoteAssistantSkillSlug(QUOTE_ASSISTANT_SKILL_SLUG)).toBe(true);
    expect(hasQuoteAssistantSkill([{ slug: QUOTE_ASSISTANT_SKILL_SLUG }])).toBe(true);
    expect(hasQuoteAssistantSkill([{ slug: 'other' }])).toBe(false);
  });

  it('provides default embed composer actions with quote skill', () => {
    expect(DEFAULT_QUOTE_EMBED_COMPOSER_ACTIONS.length).toBeGreaterThan(0);
    expect(DEFAULT_QUOTE_EMBED_COMPOSER_ACTIONS[0].skillSlugs).toContain(QUOTE_ASSISTANT_SKILL_SLUG);
  });
});
