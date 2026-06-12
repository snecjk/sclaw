import { stripInstructionFromTaskMessage } from '@/lib/scheduled-task-recipients';
import type { CronJob } from '@/types/cron';

function parseCronStringLabel(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, day, , weekday] = parts;
  const timeLabel = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  const weekdayMap: Record<string, string> = {
    '0': '周日', '1': '周一', '2': '周二', '3': '周三',
    '4': '周四', '5': '周五', '6': '周六',
  };

  if (day !== '*' && weekday === '*') {
    return `每月 ${day} 日 ${timeLabel}`;
  }
  if (weekday !== '*' && weekday.includes(',')) {
    const days = weekday.split(',').map(d => weekdayMap[d] || d).join('、');
    return `${days} ${timeLabel}`;
  }
  if (weekday === '1-5') return `工作日 ${timeLabel}`;
  if (weekday !== '*' && weekdayMap[weekday]) {
    return `${weekdayMap[weekday]} ${timeLabel}`;
  }
  return `每天 ${timeLabel}`;
}

export function parseScheduleLabel(schedule: CronJob['schedule']): string {
  if (!schedule) return '';

  // Handle Gateway CronSchedule object format
  if (typeof schedule === 'object') {
    if (schedule.kind === 'cron' && schedule.expr) {
      return parseCronStringLabel(schedule.expr);
    }
    if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
      const ms = schedule.everyMs;
      if (ms < 60_000) return `每 ${Math.round(ms / 1000)} 秒`;
      if (ms < 3_600_000) return `每 ${Math.round(ms / 60_000)} 分钟`;
      if (ms < 86_400_000) return `每 ${Math.round(ms / 3_600_000)} 小时`;
      return `每 ${Math.round(ms / 86_400_000)} 天`;
    }
    if (schedule.kind === 'at' && schedule.at) {
      try {
        return `执行一次，时间：${new Date(schedule.at).toLocaleString()}`;
      } catch {
        return `执行一次，时间：${schedule.at}`;
      }
    }
    return JSON.stringify(schedule);
  }

  // Handle plain cron string
  if (typeof schedule === 'string') {
    return parseCronStringLabel(schedule);
  }

  return String(schedule);
}

export function filterTasks(tasks: CronJob[], query: string): CronJob[] {
  if (!query.trim()) return tasks;
  const q = query.trim().toLowerCase();
  return tasks.filter((t) => {
    const message = stripInstructionFromTaskMessage(t.message || '');
    return t.name.toLowerCase().includes(q) || message.toLowerCase().includes(q);
  });
}

export function sortTasks(tasks: CronJob[], sort: string): CronJob[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'created-asc':
      return sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'created-desc':
      return sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    default:
      return sorted;
  }
}
