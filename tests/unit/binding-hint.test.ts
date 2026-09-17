import { describe, expect, it } from 'vitest';
import {
  dingTalkReplaceHint,
  mobileBindButtonKind,
  mobileReplaceHint,
  parseReplaceReason,
} from '@/pages/Channels/binding-hint';

describe('mobileReplaceHint', () => {
  it('returns null while bound or enabled', () => {
    expect(mobileReplaceHint({
      bindStatus: 'bound',
      enabled: true,
      replaceReason: 'unbound',
    })).toBeNull();
    expect(mobileReplaceHint({
      bindStatus: 'bound',
      enabled: false,
      replaceReason: 'other_device',
    })).toBeNull();
  });

  it('returns replaceReason only when revoked and disabled', () => {
    expect(mobileReplaceHint({
      bindStatus: 'revoked',
      enabled: false,
      replaceReason: 'unbound',
    })).toBe('unbound');
    expect(mobileReplaceHint({
      bindStatus: 'revoked',
      enabled: false,
      replaceReason: 'other_device',
    })).toBe('other_device');
    expect(mobileReplaceHint({
      bindStatus: 'revoked',
      enabled: false,
      replaceReason: null,
    })).toBeNull();
  });
});

describe('dingTalkReplaceHint', () => {
  it('returns null when local is missing or not bound', () => {
    expect(dingTalkReplaceHint({
      local: null,
      remote: { bound: false },
      deviceId: 'd1',
    })).toBeNull();
    expect(dingTalkReplaceHint({
      local: { bindStatus: 'revoked' },
      remote: { bound: false },
      deviceId: 'd1',
    })).toBeNull();
  });

  it('maps remote unbound / other device while local remains bound', () => {
    expect(dingTalkReplaceHint({
      local: { bindStatus: 'bound' },
      remote: { bound: false },
      deviceId: 'd1',
    })).toBe('unbound');
    expect(dingTalkReplaceHint({
      local: { bindStatus: 'bound' },
      remote: { bound: true, deviceId: 'other' },
      deviceId: 'd1',
    })).toBe('other_device');
    expect(dingTalkReplaceHint({
      local: { bindStatus: 'bound' },
      remote: { bound: true, deviceId: 'd1' },
      deviceId: 'd1',
    })).toBeNull();
  });
});

describe('mobileBindButtonKind', () => {
  it('uses replaceReason for configure and ignores localStorage semantics', () => {
    expect(mobileBindButtonKind({
      bindStatus: 'revoked',
      enabled: false,
      replaceReason: 'other_device',
    })).toBe('configure');
    expect(mobileBindButtonKind({
      bindStatus: 'revoked',
      enabled: false,
      replaceReason: null,
    })).toBe('bind');
    expect(mobileBindButtonKind({
      bindStatus: null,
      enabled: false,
      replaceReason: null,
    })).toBe('bind');
  });
});

describe('parseReplaceReason', () => {
  it('accepts only known reasons', () => {
    expect(parseReplaceReason('unbound')).toBe('unbound');
    expect(parseReplaceReason('other_device')).toBe('other_device');
    expect(parseReplaceReason('bound_on_another_device')).toBeNull();
    expect(parseReplaceReason(undefined)).toBeNull();
  });
});
