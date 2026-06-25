/** 与 SchedulePicker 兼容的计划值类型（不含 once） */
export interface ScheduleValueCompat {
  frequency: 'daily' | 'weekly' | 'monthly';
  weekDays: number[];
  monthDay?: number;
  time: string;
}

/** 完整计划值类型（含 once，用于 Cron/ScheduledTasks 页面） */
export interface ScheduleValueFull {
  frequency: 'daily' | 'weekly' | 'monthly' | 'once';
  onceDate?: string;
  weekDays: number[];
  monthDay?: number;
  time: string;
}

export function scheduleValueToCron(value: ScheduleValueCompat | ScheduleValueFull): string {
  const [hour, minute] = value.time.split(':');
  const m = minute || '00';
  const h = hour || '09';
  switch (value.frequency) {
    case 'daily': return `${m} ${h} * * *`;
    case 'weekly': {
      const days = value.weekDays;
      if (days.length === 0) return `${m} ${h} * * *`;
      if (days.length === 7) return `${m} ${h} * * *`;
      return `${m} ${h} * * ${days.join(',')}`;
    }
    case 'monthly': return `${m} ${h} ${value.monthDay ?? 1} * *`;
    default: return `${m} ${h} * * *`;
  }
}

export function cronToScheduleValue(cron: string | unknown): ScheduleValueCompat {
  if (typeof cron !== 'string') {
    if (cron && typeof cron === 'object') {
      const s = cron as { kind?: string; expr?: string };
      if (s.kind === 'cron' && typeof s.expr === 'string') {
        return cronToScheduleValue(s.expr);
      }
    }
    return defaultScheduleValue();
  }
  const parts = cron.split(' ');
  if (parts.length !== 5) return defaultScheduleValue();
  const [min, hour, day, , weekday] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  if (weekday !== '*' && day === '*') {
    if (weekday === '1-5') {
      return { frequency: 'weekly', time, weekDays: [1, 2, 3, 4, 5] };
    }
    if (weekday.includes(',')) {
      const days = weekday.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d));
      return { frequency: 'weekly', time, weekDays: days };
    }
    const wd = parseInt(weekday, 10);
    if (!isNaN(wd)) {
      return { frequency: 'weekly', time, weekDays: [wd] };
    }
  }
  if (day !== '*') {
    const md = parseInt(day, 10);
    return { frequency: 'monthly', time, monthDay: isNaN(md) ? 1 : md, weekDays: [1, 2, 3, 4, 5] };
  }
  return { frequency: 'daily', time, weekDays: [1, 2, 3, 4, 5] };
}

export function defaultScheduleValue(): ScheduleValueCompat {
  return {
    frequency: 'daily',
    time: '09:00',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
  };
}
