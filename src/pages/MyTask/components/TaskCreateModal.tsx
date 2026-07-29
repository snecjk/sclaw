import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ChevronDown, Check, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { SchedulePicker, type ScheduleValue } from './SchedulePicker';
import {
  scheduleValueToCron,
  cronToScheduleValue,
  defaultScheduleValue,
} from '../lib/schedule-utils';
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
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

interface TaskCreateModalInnerProps {
  job?: ManagedLocalTask | null;
  onClose: () => void;
  onSave: (input: TaskCreateInputWithRun) => Promise<void>;
  initialValues?: { name?: string; message?: string; schedule?: string; workflowCode?: string };
}

function buildWorkflowInstructions(workflowCode: string, label?: string, t?: (key: string, options?: Record<string, unknown>) => string): string {
  if (t) {
    return label
      ? t('myTask.createModal.buildWorkflowInstructions', { workflowCode, label })
      : t('myTask.createModal.buildWorkflowInstructionsNoLabel', { workflowCode });
  }
  return label
    ? `帮我执行 id 为：${workflowCode} 的工作流 【${label}】`
    : `帮我执行 id 为：${workflowCode} 的工作流`;
}

function computeInitialValues(
  job: ManagedLocalTask | null | undefined,
  initialValues: { name?: string; message?: string; schedule?: string; workflowCode?: string } | undefined
) {

  if (job) {
    return {
      name: job.name || '',
      instructions: stripInstructionFromTaskMessage(job.prompt || ''),
      schedule: cronToScheduleValue(job.cronExpr),
      recipients: job.dingtalkRecipients ?? resolveScheduledTaskMentions(job.prompt || ''),
      engineType: job.engineType,
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
      engineType: 'claude' as TaskEngineType,
      selectedWorkflow: initialValues.workflowCode || '',
    };
  }

  return {
    name: '',
    instructions: '',
    schedule: defaultScheduleValue(),
    recipients: [] as DingTalkMention[],
    engineType: 'claude' as TaskEngineType,
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
  return (
    <AnimatePresence>
      {open && (
        <TaskCreateModalInner
          key={job?.id ?? `workflow:${initialValues?.workflowCode ?? '__create__'}`}
          job={job}
          onClose={onClose}
          onSave={onSave}
          initialValues={initialValues}
        />
      )}
    </AnimatePresence>
  );
}

function TaskCreateModalInner({ job, onClose, onSave, initialValues }: TaskCreateModalInnerProps) {
  const { t } = useTranslation('tasks');
  const fetchWorkflows = useMyTaskStore((s) => s.fetchWorkflows);
  const workflowOptions = useMyTaskStore((s) => s.workflowOptions);

  useEffect(() => {
    fetchWorkflows().catch(() => {});
  }, [fetchWorkflows]);

  const init = computeInitialValues(job, initialValues);

  // 预选工作流但未带 instructions 时，按 dropdown 选中分支同源逻辑补模板文本，
  // 避免 workflowDisabled 锁死空指令框导致校验失败。
  const correctedInstructions =
    init.selectedWorkflow && !init.instructions
      ? buildWorkflowInstructions(
          init.selectedWorkflow,
          workflowOptions.find((o) => o.value === init.selectedWorkflow)?.label,
          t,
        )
      : init.instructions;

  const [name, setName] = useState(init.name);
  const [instructions, setInstructions] = useState(correctedInstructions);
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
      setErrors((prev) => ({ ...prev, instructions: t('myTask.createModal.instructionsRequired') }));
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
      }>('/api/scheduled-tasks/beautify-instruction', {
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
        toast.info(t('myTask.createModal.beautifyNoChange'));
        return;
      }

      if (result.source === 'rules-fallback') {
        toast.warning(t('myTask.createModal.beautifyFallback'));
        return;
      }

      toast.success(
        result.model
          ? t('myTask.createModal.beautifySuccessWithModel', { model: result.model })
          : t('myTask.createModal.beautifySuccess'),
      );
    } catch (err) {
      toast.error(String(err) || t('myTask.createModal.beautifyFailed'));
    } finally {
      setBeautifying(false);
    }
  };

  const handleSubmit = async () => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = t('myTask.createModal.nameRequired');
    if (!instructions.trim()) newErrors.instructions = t('myTask.createModal.instructionsRequired');
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
      if (message.includes('409') || message.includes(t('myTask.error.nameDuplicate'))) {
        setErrors({ name: t('myTask.error.nameDuplicate') });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <motion.div
        className="w-full max-w-[min(820px,100%)] bg-background rounded-[22px] border border-border shadow-2xl flex flex-col max-h-[calc(100vh-4rem)]"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="flex items-start justify-between gap-4 mb-6 px-[18px] pt-[18px] flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-foreground tracking-[-0.02em] leading-[1.3] mb-2.5">
              {isEditing ? t('myTask.createModal.editTitle') : t('myTask.createModal.createTitle')}
            </h2>
            <p className="text-[13px] leading-[1.55] text-muted-foreground">
              {t('myTask.createModal.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 flex items-center justify-center w-9 h-9 -mr-2 -mt-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t('myTask.createModal.closeAria')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-[18px] pb-[16px] flex flex-col gap-5 flex-1 overflow-y-auto min-h-0">
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.nameLabel')}</label>
            <input
              type="text"
              value={name}
							maxLength={40}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name) setErrors((p) => ({ ...p, name: undefined }));
              }}
              disabled={isEditing}
              placeholder={t('myTask.createModal.namePlaceholder')}
              className={cn(
                'h-[42px] w-full rounded-[10px] border bg-background px-3.5 text-sm transition-colors placeholder:text-muted-foreground',
                formFieldFocusClass,
                isEditing ? 'border-border text-muted-foreground cursor-not-allowed opacity-70' : '',
                errors.name ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]' : 'border-border',
              )}
              autoComplete="off"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          {/* 执行引擎已固定为 Claude，暂时隐藏选择器 */}
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.engineLabel')}</label>
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
                ? t('myTask.createModal.engineEditHint')
                : engineType === 'claude'
                  ? t('myTask.createModal.engineClaudeHint')
                  : t('myTask.createModal.engineOpenclawHint')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.workflowLabel')}</label>
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
                    : t('myTask.createModal.workflowPlaceholder')}
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
                        {t('myTask.createModal.workflowEmpty')}
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
                              setInstructions(buildWorkflowInstructions(opt.value, opt.label, t));
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

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">
              {t('myTask.createModal.instructionsLabel')}
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
                placeholder={t('myTask.createModal.instructionsPlaceholder')}
                className={cn(
                  'w-full resize-none rounded-[10px] border bg-background px-3.5 pt-2.5 pb-11 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground',
                  formFieldFocusClass,
                  errors.instructions ? 'border-destructive shadow-[0_0_0_3px_rgba(220,38,38,0.12)]' : 'border-border',
                  workflowDisabled && 'cursor-not-allowed bg-muted opacity-70',
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
                aria-label={t('myTask.createModal.beautifyAria')}
              >
                {beautifying ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                {beautifying
                  ? t('myTask.createModal.beautifying')
                  : t('myTask.createModal.beautifyButton')}
              </button>
            </div>
            {errors.instructions && <p className="text-xs text-destructive">{errors.instructions}</p>}
            {workflowDisabled ? (
              <p className="text-xs text-muted-foreground">{t('myTask.createModal.workflowAutoHint')}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="block text-sm font-semibold text-foreground">{t('myTask.createModal.scheduleLabel')}</span>
            <SchedulePicker value={schedule} onChange={setSchedule} />
          </div>

          <div className="flex flex-col gap-2">
            <label className="block text-sm font-semibold text-foreground">{t('myTask.createModal.recipientsLabel')}</label>
            <DingTalkRecipientField value={recipients} onChange={setRecipients} />
          </div>
        </div>

        <div className="flex justify-end gap-3 px-[18px] py-4 border-t border-border bg-muted/20 rounded-b-[22px] flex-shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="rounded-[10px] px-5 h-[42px] text-sm"
          >
            {t('myTask.createModal.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className={modalPrimarySubmitButtonClass}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                {t('myTask.createModal.saving')}
              </>
            ) : (
              t('myTask.createModal.save')
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
