/**
 * Quote workbench detection for App Plaza embed sessions — auto-bind quote-assistant skill.
 */
import type { EmbedComposerAction } from './embed-composer-actions';
import { isVipClawQuotationUrl } from './vip-claw-quotation-url';

export const QUOTE_ASSISTANT_SKILL_SLUG = 'quote-assistant';
export const QUOTE_ASSISTANT_SKILL_TITLE = '报价助手';

const QUOTE_PAGE_PATH_PATTERNS = [
  /clawquotation/i,
  /claw-quotation/i,
  /quote-ops-console/i,
  /quote-ops/i,
];

/** Builtin App Plaza id for VIP customer quotation workbench. */
export const QUOTE_EMBED_APP_ID = 'customer-quote';

export function isQuoteEmbedPageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (isVipClawQuotationUrl(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    const combined = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return QUOTE_PAGE_PATH_PATTERNS.some((re) => re.test(combined));
  } catch {
    return QUOTE_PAGE_PATH_PATTERNS.some((re) => re.test(trimmed));
  }
}

export function isQuoteAssistantSkillSlug(slug: string | undefined | null): boolean {
  return slug?.trim().toLowerCase() === QUOTE_ASSISTANT_SKILL_SLUG;
}

export function hasQuoteAssistantSkill(
  skillMetas: Array<{ slug: string }> | undefined | null,
): boolean {
  return skillMetas?.some((s) => isQuoteAssistantSkillSlug(s.slug)) ?? false;
}

export const DEFAULT_QUOTE_EMBED_COMPOSER_ACTIONS: EmbedComposerAction[] = [
  {
    id: 'quote-new',
    label: '新建报价',
    sendText: '新建报价',
    skillSlugs: [QUOTE_ASSISTANT_SKILL_SLUG],
  },
  {
    id: 'quote-upload',
    label: '上传报价表',
    sendText: '上传报价表',
    skillSlugs: [QUOTE_ASSISTANT_SKILL_SLUG],
  },
];
