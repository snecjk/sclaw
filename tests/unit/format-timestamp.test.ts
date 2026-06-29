import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimestamp } from '../../src/pages/Chat/message-utils';

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 29, 15, 0, 0)); // 2026-06-29 15:00 local
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty for invalid timestamps', () => {
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
  });

  it('shows relative time for recent messages on the same day', () => {
    expect(formatTimestamp(new Date(2026, 5, 29, 14, 59, 30).getTime())).toBe('刚刚');
    expect(formatTimestamp(new Date(2026, 5, 29, 14, 30, 0).getTime())).toBe('30 分钟前');
    expect(formatTimestamp(new Date(2026, 5, 29, 12, 0, 0).getTime())).toBe('3 小时前');
  });

  it('shows yesterday with time', () => {
    const ts = new Date(2026, 5, 28, 18, 12, 0).getTime();
    expect(formatTimestamp(ts)).toBe('昨天 18:12');
  });

  it('shows month-day within the past week', () => {
    const ts = new Date(2026, 5, 26, 18, 12, 0).getTime();
    expect(formatTimestamp(ts)).toBe('6月26日 18:12');
  });

  it('shows year for messages older than a week', () => {
    const ts = new Date(2026, 5, 15, 9, 30, 0).getTime();
    expect(formatTimestamp(ts)).toBe('2026/6/15 09:30');
  });

  it('shows year for messages from a previous calendar year', () => {
    const ts = new Date(2025, 11, 31, 23, 59, 0).getTime();
    expect(formatTimestamp(ts)).toBe('2025/12/31 23:59');
  });

  it('parses ISO timestamp strings', () => {
    expect(formatTimestamp('2026-06-26T10:12:00')).toBe('6月26日 10:12');
  });
});
