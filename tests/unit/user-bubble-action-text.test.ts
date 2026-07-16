import { describe, expect, it } from 'vitest';
import { resolveUserBubbleActionText } from '@/pages/Chat/message-utils';

describe('resolveUserBubbleActionText (copy/share/edit source text)', () => {
  it('returns the skill title when the body is empty (skill-only bubble)', () => {
    expect(
      resolveUserBubbleActionText('', { title: '网点面单报价' }),
    ).toBe('网点面单报价');
  });

  it('combines the skill title and body when both are present', () => {
    expect(
      resolveUserBubbleActionText('帮我算一下', { title: '网点面单报价' }),
    ).toBe('网点面单报价 帮我算一下');
  });

  it('returns the body text for a normal (non-skill) message', () => {
    expect(resolveUserBubbleActionText('你好', undefined)).toBe('你好');
  });

  it('trims whitespace-only body and falls back to the title', () => {
    expect(
      resolveUserBubbleActionText('   ', { title: '网点面单报价' }),
    ).toBe('网点面单报价');
  });

  it('returns an empty string when neither title nor body exist', () => {
    expect(resolveUserBubbleActionText('', undefined)).toBe('');
    expect(resolveUserBubbleActionText('', { title: '   ' })).toBe('');
  });
});
