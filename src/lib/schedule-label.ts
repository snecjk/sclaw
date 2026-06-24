/**
 * parseScheduleToLabel — 将 cron 表达式转为人类可读的中文计划文本
 * 例如 "0 9 * * 1-5" → "工作日 09:00"
 */

export function parseScheduleToLabel(schedule: string | unknown): string {
  if (typeof schedule !== 'string') return '';
  const presets: Record<string, string> = {
    '0 9 * * 1-5': '工作日 09:00',
    '0 8 * * *': '每天 08:00',
    '0 9 1 * *': '每月 1 日 09:00',
    '0 9 * * *': '每天 09:00',
  };
  if (presets[schedule]) return presets[schedule];

  const parts = schedule.split(' ');
  if (parts.length !== 5) return schedule;
  const [min, hour, day, , weekday] = parts;

  const weekdayMap: Record<string, string> = {
    '0': '周日',
    '1': '周一',
    '2': '周二',
    '3': '周三',
    '4': '周四',
    '5': '周五',
    '6': '周六',
  };

  const timeLabel = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  if (day !== '*' && weekday === '*') {
    return `每月 ${day} 日 ${timeLabel}`;
  }

  if (weekday !== '*' && weekday.includes(',')) {
    const days = weekday.split(',').map((d) => weekdayMap[d] || d).join('、');
    return `${days} ${timeLabel}`;
  }

  if (weekday === '1-5') return `工作日 ${timeLabel}`;

  if (weekday !== '*' && weekdayMap[weekday]) {
    return `${weekdayMap[weekday]} ${timeLabel}`;
  }

  return `每天 ${timeLabel}`;
}