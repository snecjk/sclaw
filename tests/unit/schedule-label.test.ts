import { describe, expect, it } from 'vitest';
import { parseScheduleToLabel } from '../../src/lib/schedule-label';

describe('parseScheduleToLabel', () => {
  it('keeps preset labels', () => {
    expect(parseScheduleToLabel('0 9 * * *')).toBe('每天 09:00');
    expect(parseScheduleToLabel('0 9 * * 1-5')).toBe('工作日 09:00');
    expect(parseScheduleToLabel('0 8 * * *')).toBe('每天 08:00');
    expect(parseScheduleToLabel('0 9 1 * *')).toBe('每月 1 日 09:00');
  });

  it('joins multiple daily times', () => {
    expect(parseScheduleToLabel('0 9,15 * * *')).toBe('每天 09:00、15:00');
    expect(parseScheduleToLabel('0 9,12,18 * * *')).toBe('每天 09:00、12:00、18:00');
  });

  it('joins weekday lists with multiple times', () => {
    expect(parseScheduleToLabel('0 9,18 * * 1,3')).toBe('周一、周三 09:00、18:00');
  });

  it('labels same-hour multi-minute times', () => {
    expect(parseScheduleToLabel('0,30 9 * * *')).toBe('每天 09:00、09:30');
  });

  it('joins semicolon-separated independent times', () => {
    expect(parseScheduleToLabel('0 9 * * *;30 15 * * *')).toBe('每天 09:00、15:30');
    expect(parseScheduleToLabel('30 15 * * *;0 9 * * *')).toBe('每天 09:00、15:30');
  });

  it('labels monthly multi-day, last day, and mixed', () => {
    expect(parseScheduleToLabel('0 9 1,15 * *')).toBe('每月 1、15 日 09:00');
    expect(parseScheduleToLabel('0 9 L * *')).toBe('每月最后一个自然日 09:00');
    expect(parseScheduleToLabel('0 9 1,L * *')).toBe('每月 1 日、当月最后一个自然日 09:00');
    expect(parseScheduleToLabel('0 9 30 * *')).toBe('每月 30 日 09:00');
  });

  it('returns empty for non-string input', () => {
    expect(parseScheduleToLabel(null)).toBe('');
    expect(parseScheduleToLabel({ kind: 'cron' })).toBe('');
  });

  it('keeps the original cron when it cannot be represented in the picker', () => {
    expect(parseScheduleToLabel('*/5 * * * *')).toBe('*/5 * * * *');
    expect(parseScheduleToLabel('0,15,30,45 9-20 * * *')).toBe('0,15,30,45 9-20 * * *');
    expect(parseScheduleToLabel('0 9 * * 1;0 10 * * 2')).toBe('0 9 * * 1;0 10 * * 2');
  });

  it('labels monthly parts split by day when times form a complete rectangle', () => {
    expect(parseScheduleToLabel('0 10,13 1 * *;0 10,13 2 * *;0 10,13 L * *')).toBe(
      '每月 1、2 日、当月最后一个自然日 10:00、13:00',
    );
  });
});
