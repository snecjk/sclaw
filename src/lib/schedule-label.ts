/**
 * parseScheduleToLabel — 将 cron 表达式转为人类可读的中文计划文本
 * 例如 "0 9 * * 1-5" → "工作日 09:00"
 *      "0 9,15 * * *" → "每天 09:00、15:00"
 *      "0 9 * * *;30 15 * * *" → "每天 09:00、15:30"
 */

import {
  splitCronExprParts,
  tryCronToScheduleValue,
  type ScheduleValue,
} from '@/pages/MyTask/lib/schedule-utils';

const WEEKDAY_LABEL: Record<number, string> = {
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
};

function isWorkdays(days: number[]): boolean {
  return days.length === 5 && days.every((d) => [1, 2, 3, 4, 5].includes(d));
}

function formatFromScheduleValue(value: ScheduleValue): string {
  const timeLabel = value.times.join('、');
  if (value.frequency === 'monthly') {
    const days = (value.monthDays ?? []).slice().sort((a, b) => a - b);
    const lastDay = Boolean(value.monthLastDay);
    if (days.length === 0 && lastDay) return `每月最后一个自然日 ${timeLabel}`;
    const dayLabel = `${days.join('、')} 日`;
    if (lastDay) return `每月 ${dayLabel}、当月最后一个自然日 ${timeLabel}`;
    return `每月 ${dayLabel} ${timeLabel}`;
  }
  if (value.frequency === 'weekly') {
    if (isWorkdays(value.weekDays)) return `工作日 ${timeLabel}`;
    const days = value.weekDays.slice().sort((a, b) => a - b).map((d) => WEEKDAY_LABEL[d] || String(d)).join('、');
    return `${days} ${timeLabel}`;
  }
  return `每天 ${timeLabel}`;
}

function looksLikeFiveField(expr: string): boolean {
  return expr.trim().split(/\s+/).length === 5;
}

export function parseScheduleToLabel(schedule: string | unknown): string {
  if (typeof schedule !== 'string') return '';
  const presets: Record<string, string> = {
    '0 9 * * 1-5': '工作日 09:00',
    '0 8 * * *': '每天 08:00',
    '0 9 1 * *': '每月 1 日 09:00',
    '0 9 * * *': '每天 09:00',
  };
  if (presets[schedule]) return presets[schedule];

  if (schedule.includes(';')) {
    const parts = splitCronExprParts(schedule);
    if (parts.length === 0 || parts.some((part) => !looksLikeFiveField(part))) return schedule;
  } else if (!looksLikeFiveField(schedule)) {
    return schedule;
  }

  const parsed = tryCronToScheduleValue(schedule);
  if (!parsed) return schedule;
  return formatFromScheduleValue(parsed);
}
