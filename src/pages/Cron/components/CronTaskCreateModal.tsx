import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DingTalkRecipientField } from '@/components/dingtalk/DingTalkRecipientField';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import { scheduleValueToCron, cronToScheduleValue, defaultScheduleValue } from './schedule-utils';
import { resolveScheduledTaskMentions, stripInstructionFromTaskMessage } from '@/lib/scheduled-task-recipients';
import { cn } from '@/lib/utils';
import type { CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ManagedLocalTask } from '@/stores/cron';
import type { ClaudeTaskPermissionProfile } from '@/types/scheduled-task';

type TaskEngineType = 'openclaw' | 'claude';

export interface CronTaskFormInput extends CronJobCreateInput {
  engineType: TaskEngineType;
  claudeWorkspacePath?: string;
  claudePermissionProfile?: ClaudeTaskPermissionProfile;
}

interface CronTaskCreateModalProps {
  job?: ManagedLocalTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: CronTaskFormInput) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string };
}

export function CronTaskCreateModal({ job, open, onClose, onSave, initialValues }: CronTaskCreateModalProps) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [schedule, setSchedule] = useState<ScheduleValue>(defaultScheduleValue());
  const [recipients, setRecipients] = useState<DingTalkMention[]>([]);
  const [engineType, setEngineType] = useState<TaskEngineType>('openclaw');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; message?: string }>({});

  const isEditing = !!job;
  const isClaudeTask = engineType === 'claude';

  useEffect(() => {
    if (open) {
      if (job) {
        setName(job.name || '');
        if (job.engineType === 'claude') {
          setMessage(stripInstructionFromTaskMessage(job.promptTemplate || ''));
          setRecipients(resolveScheduledTaskMentions(job.promptTemplate || ''));
          setEngineType('claude');
          setSchedule(cronToScheduleValue(job.cronExpr));
        } else {
          setMessage(stripInstructionFromTaskMessage(job.message || ''));
          setRecipients(resolveScheduledTaskMentions(job.message || ''));
          setEngineType('openclaw');
          setSchedule(cronToScheduleValue(job.schedule));
        }
      } else if (initialValues) {
        setName(initialValues.name || '');
        setMessage(initialValues.message || '');
        setRecipients([]);
        setSchedule(initialValues.schedule ? cronToScheduleValue(initialValues.schedule) : defaultScheduleValue());
        setEngineType('openclaw');
      } else {
        setName('');
        setMessage('');
        setRecipients([]);
        setSchedule(defaultScheduleValue());
        setEngineType('openclaw');
      }
      setErrors({});
      setSaving(false);
    }
  }, [open, job, initialValues]);

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = '请输入任务名称';
    if (!message.trim()) newErrors.message = '请输入任务描述';
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        message: message.trim(),
        schedule: scheduleValueToCron(schedule),
        enabled: true,
        dingTalkMentions: recipients.length > 0 ? recipients : undefined,
        engineType,
        claudeWorkspacePath: undefined,
        claudePermissionProfile: engineType === 'claude' ? 'dangerous-bypass' : undefined,
      });
      onClose();
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes('409') || errStr.includes('already exists') || errStr.includes('duplicate')) {
        setErrors({ name: '任务名称已存在，请使用其他名称' });
      } else if (errStr.includes('422') || errStr.includes('validation')) {
        setErrors({ name: '输入内容不符合要求，请检查字段' });
      } else {
        setErrors({ name: '保存失败，请稍后重试' });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[calc(100vh-2rem)] bg-background rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col"
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
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
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

          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              执行引擎
            </label>
            <select
              value={engineType}
              onChange={(e) => setEngineType(e.target.value as TaskEngineType)}
              className="w-full h-10 px-3 text-[13px] rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
            >
              <option value="openclaw">OpenClaw</option>
              <option value="claude">Claude Agent</option>
            </select>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {engineType === 'claude'
                ? '将创建 Claude 本地定时任务，并在工作区基础上额外开放用户目录访问。'
                : '将创建 OpenClaw 本地定时任务。'}
            </p>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              让 STO Claw 帮你做什么…
            </label>
            <textarea
              value={message}
              onChange={(e) => { setMessage(e.target.value); if (errors.message) setErrors(p => ({ ...p, message: undefined })); }}
              rows={6}
              placeholder="让 STO Claw 帮你做什么…"
              className={cn(
                "w-full px-3 py-2.5 text-[13px] rounded-lg border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none transition-colors leading-relaxed",
                errors.message ? "border-destructive focus:border-destructive focus:ring-destructive/20" : "border-border"
              )}
            />
            {errors.message && <p className="text-[12px] text-destructive mt-1">{errors.message}</p>}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-[13.5px] font-medium text-foreground mb-1.5">
              计划时间
            </label>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          <div>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <label className="block text-[13.5px] font-medium text-foreground">
                发送对象
              </label>
            </div>
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
