import { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { DingTalkRecipientField } from '@/components/dingtalk/DingTalkRecipientField';
import { cn } from '@/lib/utils';
import type { CronJob, CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';

export type TaskCreateInputWithRun = CronJobCreateInput;

interface TaskCreateModalProps {
  job?: CronJob | null;
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

export function TaskCreateModal({ job, open, onClose, onSave, initialValues }: TaskCreateModalProps) {
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [schedule, setSchedule] = useState<ScheduleValue>(defaultScheduleValue());
  const [saving, setSaving] = useState(false);
  const [recipients, setRecipients] = useState<DingTalkMention[]>([]);
  const [errors, setErrors] = useState<{ name?: string; instructions?: string }>({});

  // 关联工作流下拉
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const workflowRef = useRef<HTMLDivElement>(null);
  const WORKFLOW_OPTIONS: { value: string; label: string }[] = [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (workflowRef.current && !workflowRef.current.contains(e.target as Node)) {
        setWorkflowOpen(false);
      }
    }
    if (workflowOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [workflowOpen]);

  const isEditing = !!job;

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- Modal form reset on open */
      if (job) {
        setName(job.name || '');
        setInstructions(job.message || '');
        setSchedule(cronToScheduleValue(job.schedule));
      } else if (initialValues) {
        setName(initialValues.name || '');
        setInstructions(initialValues.message || '');
        setSchedule(initialValues.schedule ? cronToScheduleValue(initialValues.schedule) : defaultScheduleValue());
      } else {
        setName('');
        setInstructions('');
        setSchedule(defaultScheduleValue());
      }
      setRecipients([]);
      setErrors({});
      setSaving(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, job, initialValues]);

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = '请填写任务名称';
    if (!instructions.trim()) newErrors.instructions = '请描述让 STO Claw 帮你做什么';
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
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[min(820px,100%)] bg-background rounded-[22px] border border-border shadow-2xl overflow-visible my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 px-[18px] pt-[18px]">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground tracking-[-0.02em] leading-[1.3] mb-2.5">
              {isEditing ? '编辑定时任务' : '新建定时任务'}
            </h2>
            <p className="text-[13px] leading-[1.55] text-muted-foreground">
              按计划自动执行任务，也可随时手动触发。在任意对话中描述你想定期做的事，即可快速创建。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-9 h-9 -mr-2 -mt-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="px-[18px] pb-[16px] flex flex-col gap-5">
          {/* Name */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              任务名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })); }}
              placeholder="描述你的任务"
              className={cn(
                "w-full h-[42px] px-3.5 text-sm rounded-[10px] border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] transition-colors",
                errors.name ? "border-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.12)]" : "border-border"
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
          </div>

          {/* Workflow */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              关联工作流
            </label>
            <div className="relative w-full" ref={workflowRef}>
              <button
                type="button"
                onClick={() => setWorkflowOpen(!workflowOpen)}
                className={cn(
                  "flex items-center justify-between gap-1.5 w-full h-[42px] px-3.5 pr-2.5 text-sm font-medium rounded-[10px] border bg-background cursor-pointer outline-none transition-colors",
                  workflowOpen ? "border-[#c5cad3] shadow-[0_0_0_3px_rgba(15,23,42,0.06)]" : "border-border hover:border-[#c5cad3]"
                )}
              >
                <span className={cn("truncate", !selectedWorkflow && "text-muted-foreground font-normal")}>
                  {selectedWorkflow ? WORKFLOW_OPTIONS.find(o => o.value === selectedWorkflow)?.label : '请选择'}
                </span>
                <ChevronDown className={cn('h-3 w-3 shrink-0 text-muted-foreground transition-transform', workflowOpen && 'rotate-180')} />
              </button>
              {workflowOpen && (
                <div className="absolute top-[calc(100%+6px)] left-0 z-20 w-full min-w-[140px]">
                  <div className="flex flex-col gap-0.5 max-h-[280px] p-1.5 overflow-y-auto border border-border rounded-xl bg-background shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
                    {WORKFLOW_OPTIONS.length === 0 && (
                      <div className="px-2.5 py-3 text-sm text-muted-foreground text-center">暂无可用工作流</div>
                    )}
                    {WORKFLOW_OPTIONS.map((opt) => {
                      const isSelected = selectedWorkflow === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setSelectedWorkflow(opt.value); setWorkflowOpen(false); }}
                          className={cn(
                            'flex items-center justify-between gap-2 w-full min-h-9 px-2.5 py-2 rounded-lg text-sm transition-colors',
                            isSelected ? 'font-semibold' : 'text-foreground'
                          )}
                          style={isSelected ? { background: '#fff7ed', color: '#c2410c' } : undefined}
                          onMouseEnter={(e) => { if (!isSelected) { e.currentTarget.style.background = '#fff7ed'; e.currentTarget.style.color = '#c2410c'; } }}
                          onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; } }}
                        >
                          <span>{opt.label}</span>
                          <Check className="w-4 h-4 shrink-0" style={{ color: '#c2410c', opacity: isSelected ? 1 : 0 }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Instructions */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              让 STO Claw 帮你做什么…
            </label>
            <textarea
              value={instructions}
              onChange={(e) => { setInstructions(e.target.value); if (errors.instructions) setErrors(p => ({ ...p, instructions: undefined })); }}
              rows={7}
              placeholder="让 STO Claw 帮你做什么…"
              className={cn(
                "w-full px-3.5 py-2.5 text-sm rounded-[10px] border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] resize-none transition-colors leading-relaxed",
                errors.instructions ? "border-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.12)]" : "border-border"
              )}
            />
            {errors.instructions && <p className="text-xs text-red-600">{errors.instructions}</p>}
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <span className="block text-sm font-semibold text-foreground">
              计划时间
            </span>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          {/* Recipients */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              发送对象
            </label>
            <DingTalkRecipientField value={recipients} onChange={setRecipients} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-[18px] py-4 border-t border-border bg-muted/20 rounded-b-[22px]">
          <Button variant="outline" onClick={onClose} className="rounded-[10px] px-5 h-[42px] text-sm">
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="rounded-[10px] px-5 h-[42px] text-sm bg-[#111] text-white border-none shadow-[0_2px_10px_rgba(0,0,0,0.15)] hover:bg-[#111]">
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
