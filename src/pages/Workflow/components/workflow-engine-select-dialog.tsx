import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Check, Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { invokeIpc } from '@/lib/api-client';
import { getAgentEngineDisplayName } from '@/lib/agent-engine-display-name';

type WorkflowEngineType = 'claude' | 'openclaw';

interface WorkflowEngineSelectDialogProps {
  open: boolean;
  workflowName: string;
  onCancel: () => void;
  onConfirm: (engineType: WorkflowEngineType) => void;
}

/** Card "run now" selector, kept small because inputs are collected by the workflow itself. */
export function WorkflowEngineSelectDialog({
  open,
  workflowName,
  onCancel,
  onConfirm,
}: WorkflowEngineSelectDialogProps) {
  const [engineType, setEngineType] = useState<WorkflowEngineType>('claude');
  const [isOpenClawReady, setIsOpenClawReady] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    void invokeIpc<boolean>('openclaw:isReady').then(setIsOpenClawReady).catch(() => setIsOpenClawReady(false));
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-[rgba(15,23,42,0.42)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[calc(100%-32px)] max-w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-6 shadow-modal">
          <Dialog.Title className="text-lg font-semibold text-foreground">选择运行引擎</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">“{workflowName}”本次运行将固定使用所选引擎。</Dialog.Description>
          <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="运行引擎">
            <button type="button" role="radio" aria-checked={engineType === 'claude'} onClick={() => setEngineType('claude')}
              className={`relative rounded-xl border p-4 text-left transition-colors ${engineType === 'claude' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-muted/50'}`}>
              <Cpu className="h-5 w-5 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-foreground">{getAgentEngineDisplayName('claude')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">使用 {getAgentEngineDisplayName('claude')} 执行节点。</p>
              {engineType === 'claude' ? <Check className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden /> : null}
            </button>
            <button type="button" role="radio" aria-checked={engineType === 'openclaw'} disabled={isOpenClawReady === false} onClick={() => setEngineType('openclaw')}
              className={`relative rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${engineType === 'openclaw' ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border hover:bg-muted/50'}`}>
              <Bot className="h-5 w-5 text-primary" aria-hidden />
              <p className="mt-3 text-sm font-semibold text-foreground">{getAgentEngineDisplayName('openclaw')}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{isOpenClawReady === false ? '网关未就绪，暂不可用。' : '使用隔离的 OpenClaw 工作流运行环境。'}</p>
              {engineType === 'openclaw' ? <Check className="absolute right-3 top-3 h-4 w-4 text-primary" aria-hidden /> : null}
            </button>
          </div>
          <div className="mt-6 flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onCancel}>取消</Button>
            <Button type="button" onClick={() => onConfirm(engineType)}>开始运行</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
