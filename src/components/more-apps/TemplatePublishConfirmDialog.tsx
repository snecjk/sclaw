import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface TemplatePublishConfirmDialogProps {
  open: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function TemplatePublishConfirmDialog({
  open,
  onConfirm,
  onCancel,
}: TemplatePublishConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      overlayClassName="z-[260]"
      title="发布模板新版本"
      message="发布后会自动生成下一个 patch 版本，并用于之后新建的应用；已有应用不会变化。确认继续吗？"
      confirmLabel="确认发布"
      confirmingLabel="发布中…"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
