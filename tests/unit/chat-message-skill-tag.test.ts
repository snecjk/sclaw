import { describe, expect, it } from 'vitest';
import type { RawMessage } from '@/stores/chat/types';
import { extractText } from '@/pages/Chat/message-utils';

/** Mirrors ChatMessage early-return guard for skill-only user bubbles. */
function shouldRenderUserMessage(message: RawMessage): boolean {
  const text = extractText(message).trim();
  const hasText = text.length > 0;
  const skillMeta = message._skillMeta;
  return hasText || Boolean(skillMeta);
}

describe('skill-only user message visibility', () => {
  it('renders when _skillMeta is present and content is empty', () => {
    const message: RawMessage = {
      role: 'user',
      content: '',
      _skillMeta: { slug: 'outlet-quote', title: '网点一客一议报价' },
    };
    expect(shouldRenderUserMessage(message)).toBe(true);
  });

  it('does not render when both content and _skillMeta are absent', () => {
    const message: RawMessage = {
      role: 'user',
      content: '',
    };
    expect(shouldRenderUserMessage(message)).toBe(false);
  });
});
