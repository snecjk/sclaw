import { describe, expect, it } from 'vitest';
import {
  clearHomeLandingIntent,
  isAwaitingFirstSendTemporarySessionKey,
  peekHomeLandingIntent,
  requestHomeLanding,
} from '@/lib/home-landing';

describe('home-landing intent', () => {
  it('tracks explicit home landing until cleared', () => {
    clearHomeLandingIntent();
    expect(peekHomeLandingIntent()).toBe(false);
    requestHomeLanding();
    expect(peekHomeLandingIntent()).toBe(true);
    clearHomeLandingIntent();
    expect(peekHomeLandingIntent()).toBe(false);
  });
});

describe('isAwaitingFirstSendTemporarySessionKey', () => {
  const key = 'agent:main:session-1710000000000';

  it('returns true only for empty temporary sessions', () => {
    expect(isAwaitingFirstSendTemporarySessionKey(key, {
      messageCount: 0,
      sessionLastActivity: {},
      sessionLabels: {},
    })).toBe(true);
  });

  it('returns false when the temporary session already has messages', () => {
    expect(isAwaitingFirstSendTemporarySessionKey(key, {
      messageCount: 3,
      sessionLastActivity: {},
      sessionLabels: {},
    })).toBe(false);
  });

  it('returns false for non-temporary session keys', () => {
    expect(isAwaitingFirstSendTemporarySessionKey('agent:main:main', {
      messageCount: 0,
      sessionLastActivity: {},
      sessionLabels: {},
    })).toBe(false);
  });
});
