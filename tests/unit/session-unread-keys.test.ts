import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalSessionUnreadKey,
  collectSessionUnreadAliases,
  isSessionUnreadInStore,
} from '../../src/lib/session-unread-keys';

describe('session-unread-keys', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-29T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps base cron key to today dated session key', () => {
    expect(canonicalSessionUnreadKey('agent:main:cron:job-1'))
      .toBe('agent:main:cron:job-1:2026-06-29');
  });

  it('maps cron run key to today dated session key', () => {
    expect(canonicalSessionUnreadKey('agent:main:cron:job-1:run:abc'))
      .toBe('agent:main:cron:job-1:2026-06-29');
  });

  it('keeps dated cron key as canonical', () => {
    expect(canonicalSessionUnreadKey('agent:main:cron:job-1:2026-06-28'))
      .toBe('agent:main:cron:job-1:2026-06-28');
  });

  it('does not cross-match unread across different days', () => {
    const unreadKeys = { 'agent:main:cron:job-1:2026-06-29': true as const };
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:cron:job-1:2026-06-28')).toBe(false);
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:cron:job-1:2026-06-29')).toBe(true);
  });

  it('legacy base cron unread only matches today bucket', () => {
    const unreadKeys = { 'agent:main:cron:job-1': true as const };
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:cron:job-1:2026-06-29')).toBe(true);
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:cron:job-1:2026-06-28')).toBe(false);
  });

  it('collects day-scoped aliases for clearing today on read', () => {
    const aliases = collectSessionUnreadAliases('agent:main:cron:job-1:2026-06-29');
    expect(aliases).toContain('agent:main:cron:job-1:2026-06-29');
    expect(aliases).toContain('agent:main:cron:job-1');
    expect(aliases).not.toContain('agent:main:cron:job-1:2026-06-28');
  });

  it('collects only that day aliases when clearing a past day', () => {
    const aliases = collectSessionUnreadAliases('agent:main:cron:job-1:2026-06-28');
    expect(aliases).toEqual(['agent:main:cron:job-1:2026-06-28']);
  });

  it('keeps normal chat session keys isolated', () => {
    const unreadKeys = { 'agent:main:session-123': true as const };
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:session-123')).toBe(true);
    expect(isSessionUnreadInStore(unreadKeys, 'agent:main:cron:job-1:2026-06-29')).toBe(false);
  });
});
