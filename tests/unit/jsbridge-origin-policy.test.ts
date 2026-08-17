import { describe, expect, it } from 'vitest';
import {
  isStoCnHostname,
  isStoCnOrigin,
  matchAnyOriginPattern,
  matchOriginPattern,
  normalizeAppAllowedOrigins,
} from '../../shared/jsbridge/origin-policy';

describe('jsbridge origin policy', () => {
  it('accepts sto.cn and subdomains', () => {
    expect(isStoCnHostname('sto.cn')).toBe(true);
    expect(isStoCnHostname('policy.sto.cn')).toBe(true);
    expect(isStoCnHostname('wd-vip.sto.cn')).toBe(true);
    expect(isStoCnOrigin('https://policy.sto.cn/path')).toBe(true);
  });

  it('rejects non-sto.cn domains', () => {
    expect(isStoCnHostname('stosystem.com')).toBe(false);
    expect(isStoCnHostname('notsto.cn.evil.com')).toBe(false);
    expect(isStoCnOrigin('https://example.com')).toBe(false);
    expect(isStoCnOrigin('file:///tmp/x')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(matchOriginPattern('https://*.sto.cn', 'https://policy.sto.cn')).toBe(true);
    expect(matchOriginPattern('https://policy.sto.cn', 'https://policy.sto.cn')).toBe(true);
    expect(matchOriginPattern('https://*.sto.cn', 'https://evil.com')).toBe(false);
  });

  it('matchAnyOriginPattern falls back to global sto.cn when empty', () => {
    expect(matchAnyOriginPattern([], 'https://policy.sto.cn')).toBe(true);
    expect(matchAnyOriginPattern([], 'https://evil.com')).toBe(false);
  });

  it('normalizeAppAllowedOrigins rejects non-sto.cn patterns', () => {
    expect(() => normalizeAppAllowedOrigins(['https://*.example.com'])).toThrow(/non-sto.cn/);
    expect(normalizeAppAllowedOrigins(['https://policy.sto.cn'])).toEqual(['https://policy.sto.cn']);
  });
});
