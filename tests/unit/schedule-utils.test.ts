import { describe, expect, it } from 'vitest';
import {
  cronToScheduleValue,
  defaultScheduleValue,
  nextSuggestedTime,
  scheduleValueToCron,
  tryCronToScheduleValue,
  validateScheduleMonthDays,
  validateScheduleTimes,
  type ScheduleValue,
} from '../../src/pages/MyTask/lib/schedule-utils';

function daily(times: string[]): ScheduleValue {
  return { frequency: 'daily', times, weekDays: [1, 2, 3, 4, 5], monthDays: [1] };
}

function monthly(partial: Partial<ScheduleValue> = {}): ScheduleValue {
  return {
    frequency: 'monthly',
    times: ['09:00'],
    weekDays: [1, 2, 3, 4, 5],
    monthDays: [1],
    ...partial,
  };
}

describe('scheduleValueToCron / cronToScheduleValue', () => {
  it('round-trips a single daily time', () => {
    const cron = scheduleValueToCron(daily(['09:00']));
    expect(cron).toBe('0 9 * * *');
    expect(cronToScheduleValue(cron)).toEqual(expect.objectContaining({
      frequency: 'daily',
      times: ['09:00'],
    }));
  });

  it('encodes multiple times as semicolon-joined crons sorted by clock', () => {
    expect(scheduleValueToCron(daily(['09:00', '15:00']))).toBe('0 9 * * *;0 15 * * *');
    expect(scheduleValueToCron(daily(['09:00', '12:00', '18:00']))).toBe(
      '0 9 * * *;0 12 * * *;0 18 * * *',
    );
  });

  it('sorts before persist when the user adds later times first', () => {
    expect(scheduleValueToCron(daily(['15:30', '09:00']))).toBe('0 9 * * *;30 15 * * *');
  });

  it('round-trips mixed hour and minute as independent crons', () => {
    const cron = scheduleValueToCron(daily(['09:00', '15:30']));
    expect(cron).toBe('0 9 * * *;30 15 * * *');
    expect(cronToScheduleValue(cron).times).toEqual(['09:00', '15:30']);
  });

  it('round-trips weekly multi-hour NL cron 0 9,12,18 * * 1,3', () => {
    const value = cronToScheduleValue('0 9,12,18 * * 1,3');
    expect(value).toEqual({
      frequency: 'weekly',
      weekDays: [1, 3],
      monthDays: [1],
      times: ['09:00', '12:00', '18:00'],
    });
    expect(scheduleValueToCron(value)).toBe('0 9 * * 1,3;0 12 * * 1,3;0 18 * * 1,3');
  });

  it('round-trips multiple minutes in the same hour', () => {
    const cron = scheduleValueToCron(daily(['09:00', '09:30']));
    expect(cron).toBe('0 9 * * *;30 9 * * *');
    expect(cronToScheduleValue(cron).times).toEqual(['09:00', '09:30']);
  });

  it('pre-fills two chips when editing NL cron 0 9,15 * * *', () => {
    const value = cronToScheduleValue('0 9,15 * * *');
    expect(value.frequency).toBe('daily');
    expect(value.times).toEqual(['09:00', '15:00']);
  });

  it('expands a complete cartesian product when editing 0,30 9,15 * * *', () => {
    const value = cronToScheduleValue('0,30 9,15 * * *');
    expect(value.times).toEqual(['09:00', '09:30', '15:00', '15:30']);
    expect(scheduleValueToCron(value)).toBe('0 9 * * *;30 9 * * *;0 15 * * *;30 15 * * *');
  });

  it('expands a simple hour range', () => {
    expect(cronToScheduleValue('0 9-11 * * *').times).toEqual(['09:00', '10:00', '11:00']);
  });

  it('does not silently represent step or wildcard times in the picker model', () => {
    expect(tryCronToScheduleValue('*/5 * * * *')).toBeNull();
    expect(tryCronToScheduleValue('* * * * *')).toBeNull();
    expect(tryCronToScheduleValue('0 * * * *')).toBeNull();
    expect(cronToScheduleValue('*/5 * * * *')).toEqual(defaultScheduleValue());
  });

  it('does not decode cartesian products larger than the picker can persist', () => {
    expect(tryCronToScheduleValue('0,15,30,45 9-20 * * *')).toBeNull();
    expect(tryCronToScheduleValue('0 8-20 * * *')).toBeNull();
    expect(tryCronToScheduleValue('0 8-19 * * *')?.times).toHaveLength(12);
  });

  it('does not merge weekly parts that use different weekdays and different times', () => {
    expect(tryCronToScheduleValue('0 9 * * 1;0 10 * * 2')).toBeNull();
  });

  it('merges weekly parts that share the same time across different weekdays', () => {
    expect(tryCronToScheduleValue('0 9 * * 1;0 9 * * 2')).toEqual(expect.objectContaining({
      frequency: 'weekly',
      weekDays: [1, 2],
      times: ['09:00'],
    }));
  });

  it('merges times when weekly parts share the same weekdays', () => {
    expect(tryCronToScheduleValue('0 9 * * 1;0 10 * * 1')).toEqual(expect.objectContaining({
      frequency: 'weekly',
      weekDays: [1],
      times: ['09:00', '10:00'],
    }));
  });

  it('rejects DOM+DOW and non-wildcard month fields', () => {
    expect(tryCronToScheduleValue('0 9 1 * 1')).toBeNull();
    expect(tryCronToScheduleValue('0 9 1 1 *')).toBeNull();
  });

  it('parses monthly and weekday presets', () => {
    expect(cronToScheduleValue('0 9 1 * *')).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [1],
      times: ['09:00'],
    }));
    expect(cronToScheduleValue('0 9 * * 1-5')).toEqual(expect.objectContaining({
      frequency: 'weekly',
      weekDays: [1, 2, 3, 4, 5],
      times: ['09:00'],
    }));
  });

  it('round-trips monthly multi-day as a DOM list', () => {
    const cron = scheduleValueToCron(monthly({ monthDays: [1, 15] }));
    expect(cron).toBe('0 9 1,15 * *');
    expect(cronToScheduleValue(cron)).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [1, 15],
      monthLastDay: false,
      times: ['09:00'],
    }));
  });

  it('sorts month days before persist', () => {
    expect(scheduleValueToCron(monthly({ monthDays: [15, 1] }))).toBe('0 9 1,15 * *');
  });

  it('encodes last day of month as L', () => {
    expect(scheduleValueToCron(monthly({ monthDays: [], monthLastDay: true }))).toBe('0 9 L * *');
    expect(cronToScheduleValue('0 9 L * *')).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [],
      monthLastDay: true,
    }));
  });

  it('encodes numbered days plus last day as 1,L', () => {
    expect(scheduleValueToCron(monthly({ monthDays: [1], monthLastDay: true }))).toBe('0 9 1,L * *');
    expect(cronToScheduleValue('0 9 1,L * *')).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [1],
      monthLastDay: true,
    }));
  });

  it('pre-fills day 30 without treating it as last day', () => {
    expect(cronToScheduleValue('0 9 30 * *')).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [30],
      monthLastDay: false,
    }));
    expect(scheduleValueToCron(monthly({ monthDays: [30] }))).toBe('0 9 30 * *');
  });

  it('pre-fills existing NL monthly list 0 9 1,15 * *', () => {
    expect(cronToScheduleValue('0 9 1,15 * *').monthDays).toEqual([1, 15]);
  });

  it('does not merge an incomplete monthly time×day rectangle', () => {
    expect(tryCronToScheduleValue('0 9 1 * *;0 9 L * *;30 15 15 * *')).toBeNull();
  });

  it('merges monthly parts split by day when every day has the same times', () => {
    const value = tryCronToScheduleValue('0 10,13 1 * *;0 10,13 2 * *;0 10,13 L * *');
    expect(value).toEqual(expect.objectContaining({
      frequency: 'monthly',
      monthDays: [1, 2],
      monthLastDay: true,
      times: ['10:00', '13:00'],
    }));
  });

  it('merges times when monthly day spec is the same across parts', () => {
    const value = cronToScheduleValue('0 9 1,15,L * *;30 15 1,15,L * *');
    expect(value.frequency).toBe('monthly');
    expect(value.monthDays).toEqual([1, 15]);
    expect(value.monthLastDay).toBe(true);
    expect(value.times).toEqual(['09:00', '15:30']);
  });

  it('keeps the same DOM field across multiple times', () => {
    expect(scheduleValueToCron(monthly({ monthDays: [1, 15], times: ['09:00', '15:30'] }))).toBe(
      '0 9 1,15 * *;30 15 1,15 * *',
    );
  });
});

describe('validateScheduleTimes', () => {
  it('accepts mixed hour and minute combinations', () => {
    expect(validateScheduleTimes(['09:00', '15:00'])).toBeNull();
    expect(validateScheduleTimes(['09:00', '09:30'])).toBeNull();
    expect(validateScheduleTimes(['09:00', '15:30'])).toBeNull();
  });

  it('rejects empty times', () => {
    expect(validateScheduleTimes([])).toBe('empty');
    expect(validateScheduleTimes(['bad'])).toBe('empty');
  });
});

describe('validateScheduleMonthDays', () => {
  it('accepts numbered days or last day', () => {
    expect(validateScheduleMonthDays({ monthDays: [30] })).toBeNull();
    expect(validateScheduleMonthDays({ monthDays: [], monthLastDay: true })).toBeNull();
    expect(validateScheduleMonthDays({ monthDays: [1], monthLastDay: true })).toBeNull();
  });

  it('rejects empty month selection', () => {
    expect(validateScheduleMonthDays({ monthDays: [] })).toBe('empty');
    expect(validateScheduleMonthDays({ monthDays: [], monthLastDay: false })).toBe('empty');
  });
});

describe('nextSuggestedTime', () => {
  it('adds one hour keeping the same minute', () => {
    expect(nextSuggestedTime(['09:00'])).toBe('10:00');
    expect(nextSuggestedTime(['09:00', '10:00'])).toBe('11:00');
  });

  it('skips the next hour when it is already selected', () => {
    expect(nextSuggestedTime(['09:00', '10:00'])).toBe('11:00');
    expect(nextSuggestedTime(['23:00'])).toBe('00:00');
  });
});
