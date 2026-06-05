import { useState, useRef, useEffect } from 'react';
import { Clock, MoreHorizontal, Play, Pencil, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

import type { CronJob } from '@/types/cron';

interface TaskCardProps {
  job: CronJob;
  onToggle: (enabled: boolean, currentEnabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => void;
}

function parseScheduleToLabel(schedule: string | unknown): string {
  if (typeof schedule !== 'string') return '';
  const presets: Record<string, string> = {
    '0 9 * * 1-5': '工作日 09:00',
    '0 8 * * *': '每天 08:00',
    '0 9 1 * *': '每月 1 日 08:00',
    '0 9 * * *': '每天 09:00',
  };
  if (presets[schedule]) return presets[schedule];

  const parts = schedule.split(' ');
  if (parts.length !== 5) return schedule;
  const [min, hour, day, , weekday] = parts;
  
  // 处理工作日（weekday）部分
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
  
  // 处理每月特定日期
  if (day !== '*' && weekday === '*') {
    return `每月 ${day} 日 ${timeLabel}`;
  }
  
  // 处理特定星期几（逗号分隔，如 0,4,5）
  if (weekday !== '*' && weekday.includes(',')) {
    const days = weekday.split(',').map(d => weekdayMap[d] || d).join('、');
    return `${days} ${timeLabel}`;
  }
  
  // 处理星期范围（如 1-5）
  if (weekday === '1-5') return `工作日 ${timeLabel}`;
  
  // 处理单个星期几
  if (weekday !== '*' && weekdayMap[weekday]) {
    return `${weekdayMap[weekday]} ${timeLabel}`;
  }
  
  // 默认：每天
  return `每天 ${timeLabel}`;
}

export function TaskCard({ job, onToggle, onEdit, onDelete, onTrigger }: TaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const scheduleStr = typeof job.schedule === 'string' ? job.schedule : '';
  const scheduleLabel = parseScheduleToLabel(scheduleStr);

  return (
    <article className="task-card group relative flex flex-col rounded-xl border border-border bg-background p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30">
      {/* Title Row */}
      <div className="flex items-start gap-3 mb-3">
        <div className="mt-0.5 text-primary shrink-0">
          <Clock className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground leading-snug">
            <button
              type="button"
              onClick={onEdit}
              className="text-left hover:text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
              title="编辑任务"
            >
              {job.name}
            </button>
          </h2>
        </div>
        <Switch
          checked={job.enabled}
          onCheckedChange={(newEnabled) => onToggle(newEnabled, job.enabled)}
          aria-label={job.enabled ? '暂停任务' : '启用任务'}
        />
      </div>

      {/* Description */}
      <p className="text-[13px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
        {job.message || '暂无描述'}
      </p>

      {/* Footer */}
      <div className="mt-auto flex items-start gap-3 pt-3 border-t border-border/60">
        <span
          className="text-[12.5px] text-muted-foreground font-medium flex-1 min-w-0"
          title={scheduleLabel}
        >
          {scheduleLabel}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTrigger(); }}
            className="text-[12.5px] px-3 py-1.5 rounded-lg border border-border bg-background text-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Play className="inline-block h-3 w-3 mr-1 -mt-0.5" />
            立即运行
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 bottom-full mb-1 w-36 bg-background border border-border rounded-lg shadow-lg py-1 z-50"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-foreground hover:bg-muted transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  编辑任务
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-destructive hover:bg-destructive/5 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除任务
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
