import { describe, expect, it } from 'vitest';
import { stripLegacyAppDevPreviewAuth } from '@/lib/app-dev-preview-url';

describe('stripLegacyAppDevPreviewAuth', () => {
  it('removes legacy Token query keys while preserving business state and hash routes', () => {
    expect(stripLegacyAppDevPreviewAuth(
      'http://127.0.0.1:58967/?stoToken=tok-1&x=1#/home',
    )).toBe('http://127.0.0.1:58967/?x=1#/home');
    expect(stripLegacyAppDevPreviewAuth(
      'http://127.0.0.1:58967/?stotoken=a&StoToken=b&token=c#/home',
    )).toBe('http://127.0.0.1:58967/#/home');
  });

  it('removes callback codes and leaves invalid or empty URLs unchanged', () => {
    expect(stripLegacyAppDevPreviewAuth(
      'http://127.0.0.1:58967/?code=abc&authorizationCode=def#/home',
    )).toBe('http://127.0.0.1:58967/#/home');
    expect(stripLegacyAppDevPreviewAuth('not a url')).toBe('not a url');
    expect(stripLegacyAppDevPreviewAuth('')).toBe('');
  });
});
