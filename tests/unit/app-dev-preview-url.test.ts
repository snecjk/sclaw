import { describe, expect, it } from 'vitest';
import {
  injectAppDevPreviewStoToken,
  stripAppDevPreviewStoToken,
} from '@/lib/app-dev-preview-url';

describe('injectAppDevPreviewStoToken', () => {
  it('injects stoToken while preserving hash route', () => {
    expect(
      injectAppDevPreviewStoToken('http://127.0.0.1:58967/#/home', 'tok-1'),
    ).toBe('http://127.0.0.1:58967/?stoToken=tok-1#/home');
  });

  it('replaces existing stoToken variants', () => {
    expect(
      injectAppDevPreviewStoToken(
        'http://127.0.0.1:3000/?stotoken=old&x=1#/list',
        'tok-2',
      ),
    ).toBe('http://127.0.0.1:3000/?x=1&stoToken=tok-2#/list');
  });

  it('returns original url when token is missing', () => {
    expect(injectAppDevPreviewStoToken('http://127.0.0.1:3000/', '')).toBe(
      'http://127.0.0.1:3000/',
    );
    expect(injectAppDevPreviewStoToken('http://127.0.0.1:3000/', null)).toBe(
      'http://127.0.0.1:3000/',
    );
  });
});

describe('stripAppDevPreviewStoToken', () => {
  it('removes stoToken from search and keeps hash', () => {
    expect(
      stripAppDevPreviewStoToken('http://127.0.0.1:58967/?stoToken=tok-1#/home'),
    ).toBe('http://127.0.0.1:58967/#/home');
  });
});
