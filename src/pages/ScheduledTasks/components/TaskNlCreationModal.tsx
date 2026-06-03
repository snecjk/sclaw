import { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { cn } from '@/lib/utils';
import type { ScheduledTaskCreateInput } from '@/types/scheduled-task';
import type { ExtractedTaskParams } from '@/lib/scheduled-task-nl-extractor';

export interface TaskNlCreationModalProps {
  open: boolean;
  onClose: () => void;
  extractedParams: ExtractedTaskParams;
  onSave: (input: ScheduledTaskCreateInput & { runNow?: boolean }) => Promise<void>;
}

function cronToScheduleValue(cron: string | unknown): ScheduleValue {
  const defaultVal: ScheduleValue = {
    frequency: 'daily',
    time: '09:00',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
  };

  if (typeof cron !== 'string') return defaultVal;
  const parts = cron.split(' ');
  if (parts.length !== 5) return defaultVal;
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
    default: return `${m} ${h} * * *`;
  }
}

export function TaskNlCreationModal({ open, onClose, extractedParams, onSave }: TaskNlCreationModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schedule, setSchedule] = useState<ScheduleValue>({
    frequency: 'daily',
    time: '09:00',
    weekDays: [1, 2, 3, 4, 5],
    monthDay: 1,
  });
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; description?: string; schedule?: string }>({});

  // 初始化表单数据
  useEffect(() => {
    if (open) {
      setName(extractedParams.name || '');
      setDescription(extractedParams.description || '');
      if (extractedParams.cronExpr) {
        setSchedule(cronToScheduleValue(extractedParams.cronExpr));
      }
      setErrors({});
      setSaving(false);
    }
  }, [open, extractedParams]);

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = '请填写任务名称';
    if (!description.trim()) newErrors.description = '请描述让 STO Claw 帮你做什么';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        cronExpr: scheduleValueToCron(schedule),
        description: description.trim(),
      });
      onClose();
    } catch (err) {
      const message = String(err);
      if (message.includes('409') || message.includes('任务名称已存在')) {
        setErrors({ name: '任务名称已存在，请使用其他名称' });
      } else {
        setErrors({ name: `创建失败：${message}` });
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
              确认定时任务参数
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              已从您的描述中提取以下信息，请确认或修改
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

        {/* Extracted params warning */}
        {extractedParams.hasError && extractedParams.errors && (
          <div className="mx-6 mt-3 p-3 rounded-lg border border-orange-200 bg-orange-50 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] font-medium text-orange-900">需要补充以下信息：</p>
              <ul className="text-[12px] text-orange-700 mt-1 list-disc list-inside">
                {extractedParams.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

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

          {/* Instructions */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              让 STO Claw 帮你做什么…
            </label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); if (errors.description) setErrors(p => ({ ...p, description: undefined })); }}
              rows={4}
              placeholder="让 STO Claw 帮你做什么…"
              className={cn(
                "w-full px-3 py-2.5 text-[13px] rounded-lg border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none transition-colors leading-relaxed",
                errors.description ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "border-border"
              )}
            />
            {errors.description && <p className="text-[12px] text-destructive mt-1">{errors.description}</p>}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              计划时间
            </label>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-3 px-6 py-4 border-t border-border bg-muted/20">
          <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-lg px-5 h-9 text-[13px]">
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={saving} className="rounded-lg px-5 h-9 text-[13px]">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                创建中…
              </>
            ) : (
              '创建任务'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
