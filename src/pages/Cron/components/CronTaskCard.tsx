import { useState, useRef, useEffect } from 'react';
import { Clock, MoreHorizontal, Play, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

import { stripInstructionFromTaskMessage } from '@/lib/scheduled-task-recipients';
import type { CronJob } from '@/types/cron';
import { parseScheduleLabel } from './utils';

interface CronTaskCardProps {
  job: CronJob;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => Promise<void>;
}

export function CronTaskCard({ job, onToggle, onEdit, onDelete, onTrigger }: CronTaskCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [triggering, setTriggering] = useState(false);
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

  const scheduleLabel = parseScheduleLabel(job.schedule);
  const displayMessage = stripInstructionFromTaskMessage(job.message || '');

  const handleTrigger = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setTriggering(true);
    try {
      await onTrigger();
    } finally {
      setTriggering(false);
    }
  };

  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-background p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/30">
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
          onCheckedChange={onToggle}
          aria-label={job.enabled ? '暂停任务' : '启用任务'}
        />
      </div>

      {/* Description */}
      <p className="text-[13px] text-muted-foreground leading-relaxed mb-4 line-clamp-2">
        {displayMessage || '暂无描述'}
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
            onClick={handleTrigger}
            disabled={triggering}
            className="text-[12.5px] px-3 py-1.5 rounded-lg border border-border bg-background text-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            {triggering ? (
              <Loader2 className="inline-block h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Play className="inline-block h-3 w-3 mr-1 -mt-0.5" />
            )}
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
