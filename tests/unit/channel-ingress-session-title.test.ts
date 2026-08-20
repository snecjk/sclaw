import { describe, expect, it } from 'vitest';
import {
  deriveChannelSessionTitle,
  isBlankOrPlaceholderChannelTitle,
} from '../../electron/channels/channel-session-title';

describe('channel session title helpers', () => {
  it('trims and collapses whitespace', () => {
    expect(deriveChannelSessionTitle('  帮我查一下  今天的待办  ')).toBe('帮我查一下 今天的待办');
  });

  it('returns empty for blank prompt', () => {
    expect(deriveChannelSessionTitle('   ')).toBe('');
  });

  it('truncates long prompts with ellipsis', () => {
    const long = '啊'.repeat(60);
    const title = deriveChannelSessionTitle(long);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBe(51);
  });

  it('treats blank and placeholder titles as fillable', () => {
    expect(isBlankOrPlaceholderChannelTitle(null)).toBe(true);
    expect(isBlankOrPlaceholderChannelTitle('')).toBe(true);
    expect(isBlankOrPlaceholderChannelTitle('新对话')).toBe(true);
    expect(isBlankOrPlaceholderChannelTitle('帮我查待办')).toBe(false);
  });
});
