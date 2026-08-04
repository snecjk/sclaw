import { describe, expect, it } from 'vitest';
import {
  isSclawEmbedHttpUrl,
  isSclawEmbedLikelyDownloadUrl,
  resolveSclawEmbedWindowOpenAction,
} from '../../shared/sclaw-embed-browser-window-open';

describe('sclaw-embed-browser-window-open', () => {
  it('accepts http(s) navigable URLs as open-tab', () => {
    expect(resolveSclawEmbedWindowOpenAction('https://example.sto.cn/app')).toEqual({
      kind: 'open-tab',
      url: 'https://example.sto.cn/app',
    });
    expect(resolveSclawEmbedWindowOpenAction('  http://localhost:3000/x  ')).toEqual({
      kind: 'open-tab',
      url: 'http://localhost:3000/x',
    });
  });

  it('denies blank / non-http schemes', () => {
    expect(resolveSclawEmbedWindowOpenAction('')).toEqual({ kind: 'deny' });
    expect(resolveSclawEmbedWindowOpenAction('about:blank')).toEqual({ kind: 'deny' });
    expect(resolveSclawEmbedWindowOpenAction('javascript:alert(1)')).toEqual({ kind: 'deny' });
    expect(resolveSclawEmbedWindowOpenAction('file:///tmp/a')).toEqual({ kind: 'deny' });
  });

  it('routes likely downloads away from tabs', () => {
    expect(resolveSclawEmbedWindowOpenAction('https://cdn.example.com/a.pdf')).toEqual({
      kind: 'download',
      url: 'https://cdn.example.com/a.pdf',
    });
    expect(
      resolveSclawEmbedWindowOpenAction('https://api.example.com/export?download=1'),
    ).toEqual({
      kind: 'download',
      url: 'https://api.example.com/export?download=1',
    });
  });

  it('exposes helpers consistently', () => {
    expect(isSclawEmbedHttpUrl('https://a.com')).toBe(true);
    expect(isSclawEmbedHttpUrl('about:blank')).toBe(false);
    expect(isSclawEmbedLikelyDownloadUrl('https://a.com/report.xlsx')).toBe(true);
    expect(isSclawEmbedLikelyDownloadUrl('https://a.com/page')).toBe(false);
  });
});
