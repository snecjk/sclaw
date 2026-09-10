import { describe, expect, it } from 'vitest';
import {
  buildImRichPayload,
  extractImRichPlainText,
  IM_RICH_BIZ_TYPE,
  isImRichHtmlEmpty,
  parseImRichPayload,
  sanitizeImRichHtml,
} from '@/lib/openim/im-rich-html';

describe('im-rich-html', () => {
  it('strips script and event handlers', () => {
    const dirty = '<p onclick="alert(1)">hi<script>alert(2)</script></p><img src="https://a.com/x.png" onerror="x">';
    const clean = sanitizeImRichHtml(dirty);
    expect(clean).toContain('<p>');
    expect(clean).toContain('hi');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onerror');
    expect(clean).toContain('https://a.com/x.png');
  });

  it('keeps blob src only when allowLocalImg', () => {
    const html = '<img src="blob:http://localhost/1">';
    expect(sanitizeImRichHtml(html)).not.toContain('blob:');
    expect(sanitizeImRichHtml(html, { allowLocalImg: true })).toContain('blob:');
  });

  it('extracts plain text with image placeholder', () => {
    expect(extractImRichPlainText('<p>你好</p><p><img src="https://a.com/a.png"></p>')).toContain('你好');
    expect(extractImRichPlainText('<p><img src="https://a.com/a.png"></p>')).toBe('[图片]');
  });

  it('builds and parses payload', () => {
    const payload = buildImRichPayload('<p>hello<b>x</b></p>');
    expect(payload.bizType).toBe(IM_RICH_BIZ_TYPE);
    expect(payload.plainText).toContain('hello');
    const parsed = parseImRichPayload(JSON.stringify(payload));
    expect(parsed?.html).toContain('hello');
  });

  it('detects empty html', () => {
    expect(isImRichHtmlEmpty('')).toBe(true);
    expect(isImRichHtmlEmpty('<p><br></p>')).toBe(true);
    expect(isImRichHtmlEmpty('<p>a</p>')).toBe(false);
    expect(isImRichHtmlEmpty('<img src="https://a.com/a.png">')).toBe(false);
  });
});
