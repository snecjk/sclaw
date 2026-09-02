import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useJsBridgeHostStore } from '@/stores/jsbridge-host';

/** Global host UI for JSBridge alert/confirm — unified in-app dialogs (no window.confirm). */
export function JsBridgeHostPortal() {
  const dialog = useJsBridgeHostStore((s) => s.dialog);
  const closeDialog = useJsBridgeHostStore((s) => s.closeDialog);

  if (!dialog) return null;

  if (dialog.kind === 'alert') {
    return (
      <div
        className="sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-[100] flex items-center justify-center p-4"
        role="alertdialog"
        aria-modal="true"
      >
        <div className="sto-overlay w-full max-w-[400px] rounded-[12px] border p-5 shadow-lg">
          <h2 className="text-[16px] font-semibold text-[var(--sto-text-primary)]">{dialog.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--sto-text-tertiary)]">{dialog.message}</p>
          <div className="mt-5 flex justify-end">
            <Button type="button" onClick={() => closeDialog(true)}>
              {dialog.confirmLabel ?? '知道了'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ConfirmDialog
      open
      title={dialog.title}
      message={dialog.message}
      confirmLabel={dialog.confirmLabel ?? '确认'}
      cancelLabel={dialog.cancelLabel ?? '取消'}
      variant={dialog.destructive ? 'destructive' : 'default'}
      onConfirm={() => closeDialog(true)}
      onCancel={() => closeDialog(false)}
    />
  );
}
