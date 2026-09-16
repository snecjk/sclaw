import { describe, expect, it } from 'vitest';
import { composeInboundText, resolveMimeType } from '../../electron/message-channel/hub/inbound-media';

describe('inbound-media', () => {
  it('composes text + richText + audio recognition', () => {
    const text = composeInboundText(
      [
        { type: 'text', content: '帮我看下这张图' },
        { type: 'picture', url: 'https://example.com/a.png', fileName: 'a.png' },
        { type: 'audio', content: '明天开会', url: 'https://example.com/a.ogg' },
      ],
      '',
    );
    expect(text).toBe('帮我看下这张图\n明天开会');
  });

  it('falls back to text when parts empty', () => {
    expect(composeInboundText(undefined, '你好')).toBe('你好');
  });

  it('resolves excel mime from fileName', () => {
    expect(resolveMimeType({ type: 'file', fileName: '报表.xlsx' })).toContain('spreadsheetml');
    expect(resolveMimeType({ type: 'picture' })).toBe('image/png');
  });
});
