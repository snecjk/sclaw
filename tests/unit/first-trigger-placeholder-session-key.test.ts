import { describe, expect, it } from 'vitest';
import {
  buildFirstTriggerPlaceholderSessionKey,
  formatLocalYmdFromMs,
} from '../../shared/first-trigger-placeholder-session-key';

describe('first-trigger-placeholder-session-key', () => {
  it('formatLocalYmdFromMs uses local calendar date', () => {
    const atMs = Date.parse('2026-06-28T23:30:00+08:00');
    expect(formatLocalYmdFromMs(atMs)).toBe('2026-06-28');
  });

  it('buildFirstTriggerPlaceholderSessionKey maps cron groups', () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    expect(buildFirstTriggerPlaceholderSessionKey('cron:job-6', atMs)).toBe(
      'agent:main:cron:job-6:2026-06-28',
    );
  });

  it('buildFirstTriggerPlaceholderSessionKey maps claude groups', () => {
    const atMs = Date.parse('2026-06-28T10:00:00+08:00');
    expect(buildFirstTriggerPlaceholderSessionKey('claude-task:abc', atMs)).toBe(
      'claude-task:abc:2026-06-28',
    );
  });

  it('returns null for invalid timestamps', () => {
    expect(buildFirstTriggerPlaceholderSessionKey('cron:job-6', 0)).toBeNull();
  });
});
