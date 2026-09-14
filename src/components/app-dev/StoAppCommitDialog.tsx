import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StoAppCommitDialogProps {
  open: boolean;
  appName: string;
  initialMessage: string;
  /** `sto` = 云端源码提交；`git` = 本地 git commit */
  mode?: 'sto' | 'git';
  onCancel: () => void;
  onConfirm: (message: string) => Promise<void> | void;
}

export function StoAppCommitDialog({
  open,
  appName,
  initialMessage,
  mode = 'sto',
  onCancel,
  onConfirm,
}: StoAppCommitDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState(initialMessage);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage(initialMessage);
    window.setTimeout(() => cancelRef.current?.focus(), 0);
  }, [open, initialMessage]);

  if (!open) return null;

  const handleConfirm = () => {
    if (submitting || !message.trim()) return;
    const result = onConfirm(message.trim());
    if (result instanceof Promise) {
      setSubmitting(true);
      result.finally(() => setSubmitting(false));
    }
  };

  const isGit = mode === 'git';

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sto-app-commit-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel();
      }}
    >
      <div
        className={cn(
          'w-full max-w-[440px] overflow-hidden rounded-[12px] border border-[#E5E6EB] bg-white p-5',
          'shadow-[0_12px_40px_rgba(15,23,42,0.12)] dark:border-border dark:bg-card',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="sto-app-commit-title" className="text-[16px] font-semibold text-[#1D2129] dark:text-foreground">
            {isGit ? '提交到 Git' : '提交到 STO'}
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onCancel}
            disabled={submitting}
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-[#86909C] dark:text-muted-foreground">
          {isGit
            ? `为「${appName}」填写本次提交说明，确认后将改动提交到本地 Git 仓库。`
            : `为「${appName}」填写本次提交说明。确认后会先自动拉取远端并检查冲突，无冲突再上传代码。`}
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">提交说明</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            disabled={submitting}
            className={cn(
              'w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
            )}
            placeholder="例如：feat: 新增首页查询条件"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || !message.trim()}
            onClick={handleConfirm}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                提交中…
              </span>
            ) : (
              '确认提交'
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
