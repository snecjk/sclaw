import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

interface WorkflowDeleteConfirmProps {
  open: boolean;
  workflowName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function WorkflowDeleteConfirm({
  open,
  workflowName,
  onCancel,
  onConfirm,
}: WorkflowDeleteConfirmProps) {
  const { t } = useTranslation('workflow');

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[130] bg-[rgba(15,23,42,0.42)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[131] w-full max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-6 shadow-modal">
          <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-foreground">
            <AlertCircle className="h-[21px] w-[21px] shrink-0 text-[#c0392b]" aria-hidden />
            {t('deleteConfirm.title')}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-[13.5px] leading-relaxed text-foreground/80">
            {t('deleteConfirm.message', { name: workflowName })}
          </Dialog.Description>
          <div className="mt-3 flex items-start gap-1.5 rounded-md bg-success/10 px-[11px] py-2 text-[12.5px] leading-relaxed text-[#0a7d52]">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t('deleteConfirm.recoverHint')}
          </div>
          <div className="mt-5 flex justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('deleteConfirm.cancel')}
            </Button>
            <Button
              type="button"
              className="bg-[#c0392b] text-white hover:bg-[#c0392b]/90"
              onClick={onConfirm}
            >
              {t('deleteConfirm.confirm')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
