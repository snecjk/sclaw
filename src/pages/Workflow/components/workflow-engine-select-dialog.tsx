import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Check, Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invokeIpc } from '@/lib/api-client';
import {
  resolveWorkflowEngineSelection,
  useWorkflowEnginePolicy,
} from '@/hooks/use-workflow-engine-policy';
import type { WorkflowExecutionEngine } from '@/lib/workflow-session';

interface WorkflowEngineSelectDialogProps {
  open: boolean;
  workflowName: string;
  onCancel: () => void;
  onConfirm: (engineType: WorkflowExecutionEngine) => void;
}

/** Card "run now" selector, kept small because inputs are collected by the workflow itself. */
export function WorkflowEngineSelectDialog({
  open,
  workflowName,
  onCancel,
  onConfirm,
}: WorkflowEngineSelectDialogProps) {
  const [engineType, setEngineType] = useState<WorkflowExecutionEngine>('openclaw');
  const [isOpenClawReady, setIsOpenClawReady] = useState<boolean | null>(null);
  const policy = useWorkflowEnginePolicy();

  useEffect(() => {
    if (!open) return;
    setIsOpenClawReady(null);
    void invokeIpc<boolean>('openclaw:isReady').then(setIsOpenClawReady).catch(() => setIsOpenClawReady(false));
  }, [open]);

  useEffect(() => {
    if (!open || isOpenClawReady == null || !policy.loaded) return;
    const unavailable = new Set<WorkflowExecutionEngine>();
    if (isOpenClawReady === false) unavailable.add('openclaw');
    setEngineType(resolveWorkflowEngineSelection(
      undefined,
      policy.options,
      policy.defaultEngine,
      unavailable,
    ));
  }, [open, policy.configVersion, policy.defaultEngine, policy.ownerCode, isOpenClawReady]);

  const selectedOption = policy.options.find((option) => option.code === engineType);
  const canConfirm = policy.loaded && !policy.loading && Boolean(selectedOption)
    && !(engineType === 'openclaw' && isOpenClawReady !== true);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-[rgba(15,23,42,0.42)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[calc(100%-32px)] max-w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-6 shadow-modal">
          <Dialog.Title className="text-lg font-semibold text-foreground">选择运行引擎</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">“{workflowName}”本次运行将固定使用所选引擎。</Dialog.Description>
          <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="运行引擎">
            {policy.options.map((option) => {
              const selected = engineType === option.code;
              const openClawUnavailable = option.code === 'openclaw' && isOpenClawReady === false;
              const disabled = option.code === 'openclaw' && isOpenClawReady !== true;
              const Icon = option.code === 'claude' ? Cpu : Bot;
              return (
                <button
                  key={option.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled || policy.loading || !policy.loaded}
                  onClick={() => setEngineType(option.code)}
                  className={`relative rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-muted/50'}`}
                >
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  <p className="mt-3 text-sm font-semibold text-foreground">{option.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">使用{option.label}执行节点</p>
                  {openClawUnavailable ? <p className="mt-1 text-xs text-muted-foreground">网关未就绪，暂不可用</p> : null}
                  {selected ? <Check className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
            <Button type="button" disabled={!canConfirm} onClick={() => canConfirm && onConfirm(engineType)}>开始运行</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
