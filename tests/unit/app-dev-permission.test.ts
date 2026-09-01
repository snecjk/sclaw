import { describe, expect, it } from 'vitest';
import {
  collectAppDevUserIdentifiers,
  isAppDevUserWhitelisted,
  parseAppDevWhitelistUsers,
} from '../../shared/app-dev-permission';

describe('app-dev-permission', () => {
  it('parses comma-separated whitelist users', () => {
    expect(parseAppDevWhitelistUsers('alice, bob ,')).toEqual(['alice', 'bob']);
  });

  it('matches userName, code, or empCode case-insensitively', () => {
    const whitelist = ['Alice', 'W001'];
    expect(isAppDevUserWhitelisted({ userName: 'alice' }, whitelist)).toBe(true);
    expect(isAppDevUserWhitelisted({ code: 'w001' }, whitelist)).toBe(true);
    expect(isAppDevUserWhitelisted({ empCode: 'W001' }, whitelist)).toBe(true);
    expect(isAppDevUserWhitelisted({ userName: 'bob' }, whitelist)).toBe(false);
  });

  it('fails closed when whitelist is null or empty', () => {
    expect(isAppDevUserWhitelisted({ userName: 'alice' }, null)).toBe(false);
    expect(isAppDevUserWhitelisted({ userName: 'alice' }, [])).toBe(false);
  });

  it('collects non-empty user identifiers', () => {
    expect(collectAppDevUserIdentifiers({
      userName: 'alice',
      code: '  ',
      empCode: 'E001',
    })).toEqual(['alice', 'E001']);
  });
});
