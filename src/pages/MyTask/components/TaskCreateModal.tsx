import { useState, useEffect, useRef } from 'react';
import { X, Loader2, ChevronDown, Check, Sparkles } from 'lucide-react';
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
  stripInstructionFromTaskMessage,
  resolveScheduledTaskMentions,
} from '@/lib/scheduled-task-recipients';
import type { CronJobCreateInput } from '@/types/cron';
import type { DingTalkMention } from '@/types/dingtalk-mention';
import type { ClaudeTaskPermissionProfile } from '@/types/scheduled-task';
import type { ManagedLocalTask } from '@/stores/cron';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';

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
  initialValues?: { name?: string; message?: string; schedule?: string };
}

interface TaskCreateModalInnerProps {
  job?: ManagedLocalTask | null;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string };
}

function computeInitialValues(
  job: ManagedLocalTask | null | undefined,
  initialValues: { name?: string; message?: string; schedule?: string } | undefined
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
      selectedWorkflow: '',
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
      key={job?.id ?? '__create__'}
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

  const [name, setName] = useState(init.name);
  const [instructions, setInstructions] = useState(init.instructions);
  const [schedule, setSchedule] = useState<ScheduleValue>(init.schedule);
  const [saving, setSaving] = useState(false);
  const [beautifying, setBeautifying] = useState(false);
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

  const handleBeautify = async () => {
    const trimmed = instructions.trim();
    if (!trimmed) {
      setErrors((prev) => ({ ...prev, instructions: '请先填写任务描述' }));
      return;
    }

    const selectedWorkflowOption = selectedWorkflow
      ? workflowOptions.find((option) => option.value === selectedWorkflow)
      : undefined;

    setBeautifying(true);
    try {
      const result = await hostApiFetch<{
        instruction: string;
        changed: boolean;
        source: 'model' | 'rules-fallback';
        model?: string;
      }>('/api/cron/beautify-instruction', {
        method: 'POST',
        body: JSON.stringify({
          instruction: trimmed,
          workflowId: selectedWorkflow || undefined,
          workflowName: selectedWorkflowOption?.label,
        }),
      });

      setInstructions(result.instruction);
      if (errors.instructions) {
        setErrors((prev) => ({ ...prev, instructions: undefined }));
      }

      if (!result.changed) {
        toast.info('描述已较规范，无需调整');
        return;
      }

      if (result.source === 'rules-fallback') {
        toast.warning('模型暂时不可用，已使用基础规则优化');
        return;
      }

      toast.success(result.model ? `AI 已美化（${result.model}）` : 'AI 已美化任务描述');
    } catch (err) {
      toast.error(String(err) || 'AI 美化失败，请稍后重试');
    } finally {
      setBeautifying(false);
    }
  };

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

        <div className="px-[18px] pb-[16px] flex flex-col gap-5 flex-1 overflow-y-auto min-h-0">
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
                'w-full h-[42px] px-3.5 text-sm rounded-[10px] border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] transition-colors',
                errors.name
                  ? 'border-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.12)]'
                  : 'border-border'
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">执行引擎</label>
            <select
              value={engineType}
              onChange={(e) => setEngineType(e.target.value as TaskEngineType)}
              disabled={isEditing}
              className={cn(
                'w-full h-[42px] px-3.5 text-sm rounded-[10px] border bg-background focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] transition-colors',
                isEditing
                  ? 'border-border text-muted-foreground cursor-not-allowed opacity-70'
                  : 'border-border'
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

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">关联工作流</label>
            <div className="relative w-full" ref={workflowRef}>
              <button
                type="button"
                onClick={() => setWorkflowOpen(!workflowOpen)}
                className={cn(
                  'flex items-center justify-between gap-1.5 w-full h-[42px] px-3.5 pr-2.5 text-sm font-medium rounded-[10px] border bg-background cursor-pointer outline-none transition-colors',
                  workflowOpen
                    ? 'border-[#c5cad3] shadow-[0_0_0_3px_rgba(15,23,42,0.06)]'
                    : 'border-border hover:border-[#c5cad3]'
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
                  <div className="flex flex-col gap-0.5 max-h-[280px] p-1.5 overflow-y-auto border border-border rounded-xl bg-background shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
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
                              setInstructions(
                                `帮我执行 id 为：${opt.value} 的工作流 【${opt.label}】`
                              );
                            }
                            setWorkflowOpen(false);
                          }}
                          className={cn(
                            'flex items-center justify-between gap-2 w-full min-h-9 px-2.5 py-2 rounded-lg text-sm transition-colors',
                            isSelected ? 'font-semibold' : 'text-foreground'
                          )}
                          style={
                            isSelected ? { background: '#fff7ed', color: '#c2410c' } : undefined
                          }
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = '#fff7ed';
                              e.currentTarget.style.color = '#c2410c';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = '';
                              e.currentTarget.style.color = '';
                            }
                          }}
                        >
                          <span>{opt.label}</span>
                          <Check
                            className="w-4 h-4 shrink-0"
                            style={{ color: '#c2410c', opacity: isSelected ? 1 : 0 }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              让 S Claw 帮你做什么…
            </label>
            <div className="relative">
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
                  'w-full px-3.5 pt-2.5 pb-11 text-sm rounded-[10px] border bg-background placeholder:text-muted-foreground focus:outline-none focus:border-[#c5cad3] focus:shadow-[0_0_0_3px_rgba(15,23,42,0.06)] resize-none transition-colors leading-relaxed',
                  errors.instructions
                    ? 'border-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.12)]'
                    : 'border-border',
                  workflowDisabled && 'bg-muted cursor-not-allowed opacity-70'
                )}
              />
              <button
                type="button"
                onClick={() => { void handleBeautify(); }}
                disabled={workflowDisabled || !instructions.trim() || beautifying}
                className={cn(
                  'absolute bottom-2.5 right-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium transition-colors',
                  'border border-[#FFD7A3] bg-[#FFF5E6] text-[#C2410C]',
                  'hover:bg-[#FFEDD5] hover:border-[#FFC17A]',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#FFF5E6]',
                )}
                aria-label="AI 美化任务描述"
              >
                {beautifying ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                {beautifying ? '美化中…' : 'AI美化'}
              </button>
            </div>
            {errors.instructions && <p className="text-xs text-red-600">{errors.instructions}</p>}
            {workflowDisabled ? (
              <p className="text-xs text-muted-foreground">已关联工作流，描述内容自动生成</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                计划时间请在上方的「计划时间」中设置；可点击 AI美化 由模型优化执行描述。
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="block text-sm font-semibold text-foreground">计划时间</span>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">发送对象</label>
            <DingTalkRecipientField value={recipients} onChange={setRecipients} />
          </div>
        </div>

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
            className="rounded-[10px] px-5 h-[42px] text-sm bg-[#111] text-white border-none shadow-[0_2px_10px_rgba(0,0,0,0.15)] hover:bg-[#111]"
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
