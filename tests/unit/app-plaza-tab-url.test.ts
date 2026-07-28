import { describe, expect, it } from 'vitest';
import {
  appPlazaTabUrlsMatch,
  coerceAppPlazaNavigableUrl,
  normalizeAppPlazaTabUrl,
} from '@/lib/app-plaza-tab-url';

describe('normalizeAppPlazaTabUrl', () => {
  it('ignores hash and normalizes trailing slash', () => {
    expect(normalizeAppPlazaTabUrl('https://example.com/app/#/home')).toBe(
      'https://example.com/app',
    );
    expect(normalizeAppPlazaTabUrl('https://example.com/app/')).toBe(
      'https://example.com/app',
    );
  });

  it('adds https for bare hosts', () => {
    expect(normalizeAppPlazaTabUrl('example.com/path')).toBe(
      'https://example.com/path',
    );
  });

  it('keeps search params', () => {
    expect(normalizeAppPlazaTabUrl('https://example.com/a?x=1#frag')).toBe(
      'https://example.com/a?x=1',
    );
  });
});

describe('appPlazaTabUrlsMatch', () => {
  it('matches equivalent URLs', () => {
    expect(
      appPlazaTabUrlsMatch('https://a.com/x/', 'https://a.com/x#y'),
    ).toBe(true);
  });

  it('rejects different paths', () => {
    expect(appPlazaTabUrlsMatch('https://a.com/x', 'https://a.com/y')).toBe(false);
  });
});

describe('coerceAppPlazaNavigableUrl', () => {
  it('returns absolute https URL', () => {
    expect(coerceAppPlazaNavigableUrl('foo.com')).toBe('https://foo.com/');
  });

  it('rejects empty', () => {
    expect(coerceAppPlazaNavigableUrl('   ')).toBeNull();
  });
});
