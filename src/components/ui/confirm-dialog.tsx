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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
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
          'w-full max-w-[400px] overflow-hidden rounded-[12px] border border-[#E5E6EB] bg-white p-5',
          'shadow-[0_12px_40px_rgba(15,23,42,0.12)] focus:outline-none',
          'dark:border-border dark:bg-card',
        )}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2
          id="confirm-dialog-title"
          className="text-[16px] font-semibold leading-tight text-[#1D2129] dark:text-foreground"
        >
          {title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
            className="h-8 rounded-md border-[#E5E6EB] bg-white px-3 text-[13px] font-medium text-[#1D2129] shadow-none hover:bg-[#F7F8FA] dark:border-border dark:bg-transparent dark:text-foreground dark:hover:bg-white/[0.04]"
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={confirming}
            className={cn(
              'h-8 rounded-md px-3 text-[13px] font-medium shadow-none',
              variant === 'destructive' && 'bg-[#F53F3F] hover:bg-[#E23B3B]',
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
