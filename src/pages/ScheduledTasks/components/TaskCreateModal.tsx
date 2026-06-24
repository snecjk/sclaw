import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DingTalkRecipientField } from '@/components/dingtalk/DingTalkRecipientField';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { resolveScheduledTaskMentions, stripInstructionFromTaskMessage } from '@/lib/scheduled-task-recipients';
import { cn } from '@/lib/utils';
import type { CronJob, CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ScheduledTask } from '@/types/scheduled-task';

export type TaskCreateInputWithRun = CronJobCreateInput;

interface TaskCreateModalProps {
  job?: CronJob | null;
  sourceTask?: ScheduledTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string };
}

function defaultScheduleValue(): ScheduleValue {
  return {
    frequency: 'daily',
    time: '09:00',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
  };
}

function scheduleValueToCron(value: ScheduleValue): string {
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
    case 'once': return `${m} ${h} ${value.onceDate ? new Date(value.onceDate).getDate() : 1} ${value.onceDate ? new Date(value.onceDate).getMonth() + 1 : 1} *`;
    default: return `${m} ${h} * * *`;
  }
}

function cronToScheduleValue(cron: string | unknown): ScheduleValue {
  if (typeof cron !== 'string') return defaultScheduleValue();
  const parts = cron.split(' ');
  if (parts.length !== 5) return defaultScheduleValue();
  const [min, hour, day, , weekday] = parts;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  // Parse weekday part: could be "*", "1-5", "1,3,5", or single digit
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

export function TaskCreateModal({ job, sourceTask, open, onClose, onSave, initialValues }: TaskCreateModalProps) {
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [schedule, setSchedule] = useState<ScheduleValue>(defaultScheduleValue());
  const [recipients, setRecipients] = useState<DingTalkMention[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; instructions?: string }>({});

  const isEditing = !!job;

  useEffect(() => {
    if (open) {
      if (job) {
        setName(job.name || '');
        setInstructions(stripInstructionFromTaskMessage(job.message || ''));
        setRecipients(resolveScheduledTaskMentions(sourceTask?.description || job.message || '', sourceTask));
        setSchedule(cronToScheduleValue(job.schedule));
      } else if (initialValues) {
        setName(initialValues.name || '');
        setInstructions(initialValues.message || '');
        setRecipients([]);
        setSchedule(initialValues.schedule ? cronToScheduleValue(initialValues.schedule) : defaultScheduleValue());
      } else {
        setName('');
        setInstructions('');
        setRecipients([]);
        setSchedule(defaultScheduleValue());
      }
      setErrors({});
      setSaving(false);
    }
  }, [open, job, initialValues, sourceTask]);

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = '请填写任务名称';
    if (!instructions.trim()) newErrors.instructions = '请描述让 S Claw 帮你做什么';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        message: instructions.trim(),
        schedule: scheduleValueToCron(schedule),
        enabled: true,
        dingTalkMentions: recipients.length > 0 ? recipients : undefined,
      });
      onClose();
    } catch (err) {
      // Error is handled by parent - don't close modal on error
      const message = String(err);
      if (message.includes('409') || message.includes('任务名称已存在')) {
        setErrors({ name: '任务名称已存在，请使用其他名称' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-background rounded-2xl border border-border shadow-2xl overflow-visible my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-2">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {isEditing ? '编辑定时任务' : '新建定时任务'}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors -mr-1 -mt-1"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              任务名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }}
              placeholder="描述你的任务"
              className={cn(
                "w-full h-10 px-3 text-[13px] rounded-lg border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors",
                errors.name ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "border-border"
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-[12px] text-destructive mt-1">{errors.name}</p>}
          </div>

          {/* Workflow (placeholder) */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              关联工作流
            </label>
            <div className="relative">
              <button
                type="button"
                disabled
                className="w-full h-10 px-3 pr-8 text-[13px] rounded-lg border border-border bg-muted/40 text-muted-foreground text-left cursor-not-allowed"
              >
                <span className="text-muted-foreground">请选择</span>
              </button>
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[11.5px] text-muted-foreground mt-1">工作流关联功能即将上线</p>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              让 S Claw 帮你做什么…
            </label>
            <textarea
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value); if (errors.instructions) setErrors(p => ({ ...p, instructions: undefined })); }}
              rows={6}
              placeholder="让 S Claw 帮你做什么…"
              className={cn(
                "w-full px-3 py-2.5 text-[13px] rounded-lg border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none transition-colors leading-relaxed",
                errors.instructions ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "border-border"
              )}
            />
            {errors.instructions && <p className="text-[12px] text-destructive mt-1">{errors.instructions}</p>}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              计划时间
            </label>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          {/* Recipients */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              发送对象
            </label>
            <DingTalkRecipientField value={recipients} onChange={setRecipients} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={onClose} className="rounded-lg px-5 h-9 text-[13px]">
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="rounded-lg px-5 h-9 text-[13px]">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                保存中…
              </>
            ) : (
              '保存'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
