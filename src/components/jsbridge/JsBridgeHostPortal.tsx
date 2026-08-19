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
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
        role="alertdialog"
        aria-modal="true"
      >
        <div className="w-full max-w-[400px] rounded-[12px] border border-[#E5E6EB] bg-white p-5 shadow-lg dark:border-border dark:bg-card">
          <h2 className="text-[16px] font-semibold text-[#1D2129] dark:text-foreground">{dialog.title}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">{dialog.message}</p>
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
