import { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import {
  scheduleValueToCron,
  cronToScheduleValue,
  defaultScheduleValue,
} from '@/pages/Cron/components/schedule-utils';
import { DingTalkRecipientField } from '@/components/dingtalk/DingTalkRecipientField';
import { useMyTaskStore } from '../store';
import { cn } from '@/lib/utils';
import {
  dropdownOptionClass,
  dropdownPanelClass,
  formFieldFocusClass,
  formFieldHoverBorderClass,
  formFieldOpenClass,
  modalPrimarySubmitButtonClass,
} from '@/lib/surfaces';
import {
  stripInstructionFromTaskMessage,
  resolveScheduledTaskMentions,
} from '@/lib/scheduled-task-recipients';
import type { CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ClaudeTaskPermissionProfile } from '@/types/scheduled-task';
import type { ManagedLocalTask } from '@/stores/cron';

type TaskEngineType = 'openclaw' | 'claude';

export type TaskCreateInputWithRun = CronJobCreateInput & {
  engineType: TaskEngineType;
  claudeWorkspacePath?: string;
  claudePermissionProfile?: ClaudeTaskPermissionProfile;
};

interface TaskCreateModalProps {
  job?: ManagedLocalTask | null;
  open: boolean;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

interface TaskCreateModalInnerProps {
  job?: ManagedLocalTask | null;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

function buildWorkflowInstructions(workflowCode: string, label?: string): string {
  return label
    ? `帮我执行 id 为：${workflowCode} 的工作流 【${label}】`
    : `帮我执行 id 为：${workflowCode} 的工作流`;
}

function computeInitialValues(
  job: ManagedLocalTask | null | undefined,
  initialValues: { name?: string; message?: string; schedule?: string; workflowCode?: string } | undefined
) {

  if (job) {
    if (job.engineType === 'claude') {
      return {
        name: job.name || '',
        instructions: stripInstructionFromTaskMessage(job.promptTemplate || ''),
        schedule: cronToScheduleValue(job.cronExpr),
        recipients: resolveScheduledTaskMentions(job.promptTemplate || ''),
        engineType: 'claude' as TaskEngineType,
        selectedWorkflow: job.workflowCode || '',
      };
    }
    return {
      name: job.name || '',
      instructions: stripInstructionFromTaskMessage(job.message || ''),
      schedule: cronToScheduleValue(job.schedule),
      recipients: resolveScheduledTaskMentions(job.message || ''),
      engineType: 'openclaw' as TaskEngineType,
      selectedWorkflow: job.workflowCode || '',
    };
  }

  if (initialValues) {
    return {
      name: initialValues.name || '',
      instructions: initialValues.message || '',
      schedule: initialValues.schedule
        ? cronToScheduleValue(initialValues.schedule)
        : defaultScheduleValue(),
      recipients: [] as DingTalkMention[],
      engineType: 'openclaw' as TaskEngineType,
      selectedWorkflow: initialValues.workflowCode || '',
    };
  }

  return {
    name: '',
    instructions: '',
    schedule: defaultScheduleValue(),
    recipients: [] as DingTalkMention[],
    engineType: 'openclaw' as TaskEngineType,
    selectedWorkflow: '',
  };
}

export function TaskCreateModal({
  job,
  open,
  onClose,
  onSave,
  initialValues,
}: TaskCreateModalProps) {
  if (!open) return null;
  return (
    <TaskCreateModalInner
      key={job?.id ?? `workflow:${initialValues?.workflowCode ?? '__create__'}`}
      job={job}
      onClose={onClose}
      onSave={onSave}
      initialValues={initialValues}
    />
  );
}

function TaskCreateModalInner({ job, onClose, onSave, initialValues }: TaskCreateModalInnerProps) {
  const workflowOptions = useMyTaskStore((s) => s.workflowOptions);

  const init = computeInitialValues(job, initialValues);

  // 预选工作流但未带 instructions 时，按 dropdown 选中分支同源逻辑补模板文本，
  // 避免 workflowDisabled 锁死空指令框导致校验失败。
  const correctedInstructions =
    init.selectedWorkflow && !init.instructions
      ? buildWorkflowInstructions(
          init.selectedWorkflow,
          workflowOptions.find((o) => o.value === init.selectedWorkflow)?.label,
        )
      : init.instructions;

  const [name, setName] = useState(init.name);
  const [instructions, setInstructions] = useState(correctedInstructions);
  const [schedule, setSchedule] = useState<ScheduleValue>(init.schedule);
  const [saving, setSaving] = useState(false);
  const [recipients, setRecipients] = useState<DingTalkMention[]>(init.recipients);
  const [errors, setErrors] = useState<{ name?: string; instructions?: string }>({});
  const [engineType, setEngineType] = useState<TaskEngineType>(init.engineType);

  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>(init.selectedWorkflow);
  const workflowRef = useRef<HTMLDivElement>(null);

  const workflowDisabled = !!selectedWorkflow;

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
        workflowCode: selectedWorkflow || undefined,
        engineType,
        claudeWorkspacePath: undefined,
        claudePermissionProfile: engineType === 'claude' ? 'dangerous-bypass' : undefined,
      });
      onClose();
    } catch (err) {
      const message = String(err);
      if (message.includes('409') || message.includes('任务名称已存在')) {
        setErrors({ name: '任务名称已存在，请使用其他名称' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-start justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[min(820px,100%)] bg-background rounded-[22px] border border-border shadow-2xl my-8 flex flex-col max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 px-[18px] pt-[18px] flex-shrink-0">
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
        <div className="px-[18px] pb-[16px] flex flex-col gap-5 flex-1 overflow-y-auto min-h-0">
          {/* Name */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">任务名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              placeholder="描述你的任务"
              className={cn(
                'h-[42px] w-full rounded-[10px] border bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground',
                formFieldFocusClass,
                errors.name ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]' : 'border-border',
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* Engine Type */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">执行引擎</label>
            <select
              value={engineType}
              onChange={(e) => setEngineType(e.target.value as TaskEngineType)}
              disabled={isEditing}
              className={cn(
                'h-[42px] w-full rounded-[10px] border border-border bg-background px-3.5 text-sm transition-colors',
                formFieldFocusClass,
                isEditing ? 'border-border text-muted-foreground cursor-not-allowed opacity-70' : 'border-border',
              )}
            >
              <option value="openclaw">OpenClaw</option>
              <option value="claude">Claude Agent</option>
            </select>
            <p className="text-[11.5px] text-muted-foreground">
              {isEditing
                ? '执行引擎在创建时确定，编辑时不可更改。'
                : engineType === 'claude'
                  ? '将创建 Claude 本地定时任务，独立在本机运行。'
                  : '将创建 OpenClaw 本地定时任务。'}
            </p>
          </div>

          {/* Workflow */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">关联工作流</label>
            <div className="relative w-full" ref={workflowRef}>
              <button
                type="button"
                onClick={() => setWorkflowOpen(!workflowOpen)}
                className={cn(
                  'flex h-[42px] w-full cursor-pointer items-center justify-between gap-1.5 rounded-[10px] border bg-background px-3.5 pr-2.5 text-sm font-medium outline-none transition-colors',
                  workflowOpen ? formFieldOpenClass : cn('border-border', formFieldHoverBorderClass),
                )}
              >
                <span
                  className={cn(
                    'truncate',
                    !selectedWorkflow && 'text-muted-foreground font-normal'
                  )}
                >
                  {selectedWorkflow
                    ? workflowOptions.find((o) => o.value === selectedWorkflow)?.label
                    : '请选择'}
                </span>
                <ChevronDown
                  className={cn(
                    'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                    workflowOpen && 'rotate-180'
                  )}
                />
              </button>
              {workflowOpen && (
                <div className="absolute top-[calc(100%+6px)] left-0 z-20 w-full min-w-[140px]">
                  <div className={cn('flex max-h-[280px] flex-col gap-0.5 overflow-y-auto rounded-xl p-1.5', dropdownPanelClass)}>
                    {workflowOptions.length === 0 && (
                      <div className="px-2.5 py-3 text-sm text-muted-foreground text-center">
                        暂无可用工作流
                      </div>
                    )}
                    {workflowOptions.map((opt) => {
                      const isSelected = selectedWorkflow === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              setSelectedWorkflow('');
                              setInstructions('');
                            } else {
                              setSelectedWorkflow(opt.value);
                              setInstructions(buildWorkflowInstructions(opt.value, opt.label));
                            }
                            setWorkflowOpen(false);
                          }}
                          className={cn(
                            'flex w-full min-h-9 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm',
                            dropdownOptionClass(isSelected),
                          )}
                        >
                          <span>{opt.label}</span>
                          <Check className={cn('h-4 w-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0')} />
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
              让 S Claw 帮你做什么…
            </label>
            <textarea
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                if (errors.instructions) setErrors((p) => ({ ...p, instructions: undefined }));
              }}
              rows={8}
              disabled={workflowDisabled}
              placeholder="让 S Claw 帮你做什么…"
              className={cn(
                'w-full resize-none rounded-[10px] border bg-background px-3.5 py-2.5 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground',
                formFieldFocusClass,
                errors.instructions ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]' : 'border-border',
                workflowDisabled && 'cursor-not-allowed bg-muted opacity-70',
              )}
            />
            {errors.instructions && <p className="text-xs text-destructive">{errors.instructions}</p>}
            {workflowDisabled && (
              <p className="text-xs text-muted-foreground">已关联工作流，描述内容自动生成</p>
            )}
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <span className="block text-sm font-semibold text-foreground">计划时间</span>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          {/* Recipients */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">发送对象</label>
            <DingTalkRecipientField value={recipients} onChange={setRecipients} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-[18px] py-4 border-t border-border bg-muted/20 rounded-b-[22px] flex-shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-[10px] px-5 h-[42px] text-sm"
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className={modalPrimarySubmitButtonClass}
          >
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
