/**
 * ConfirmDialog - In-DOM confirmation dialog (replaces window.confirm)
 * Keeps focus within the renderer to avoid Windows focus loss after native dialogs.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Shown on the confirm button while an async onConfirm is in flight. */
  confirmingLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  /** 遮罩层额外 class（例如提高 z-index，叠在其他高层级弹窗之上） */
  overlayClassName?: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  confirmingLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  overlayClassName,
  onConfirm,
  onCancel,
  onError,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset confirming when dialog closes (during render to avoid setState-in-effect)
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setConfirming(false);
    }
  }

  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !confirming) {
      e.preventDefault();
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (confirming) return;
    const result = onConfirm();
    if (result instanceof Promise) {
      setConfirming(true);
      result.catch((error) => {
        if (onError) {
          onError(error);
        }
      }).finally(() => {
        setConfirming(false);
      });
    }
  };

  return createPortal(
    <div
      className={cn(
        'sto-overlay-scrim sto-overlay-scrim--dialog fixed inset-0 z-50 flex items-center justify-center p-4',
        overlayClassName,
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !confirming) {
          onCancel();
        }
      }}
    >
      <div
        className={cn(
          'sto-overlay w-full max-w-[400px] overflow-hidden rounded-[12px] border p-5',
          'shadow-[var(--sto-shadow-dialog)] focus:outline-none',
        )}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="text-[16px] font-semibold leading-tight text-[var(--sto-text-primary)]"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--sto-text-tertiary)]">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
            className="h-8 rounded-md border-[var(--sto-border-default)] bg-[var(--sto-panel-bg)] px-3 text-[13px] font-medium text-[var(--sto-text-primary)] shadow-none hover:bg-[var(--sto-control-subtle-hover-background)]"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={confirming}
            className={cn(
              'h-8 rounded-md px-3 text-[13px] font-medium shadow-none',
              variant === 'destructive' && 'bg-[var(--sto-dialog-destructive-background)] hover:bg-[var(--sto-dialog-destructive-hover-background)]',
            )}
          >
            {confirming ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {confirmingLabel ?? confirmLabel}
              </span>
            ) : (
              confirmLabel
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
