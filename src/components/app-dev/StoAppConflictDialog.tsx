import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { StoAppConflictFile } from '@/lib/app-dev-api';

interface StoAppConflictDialogProps {
  open: boolean;
  conflicts: StoAppConflictFile[];
  busyPath?: string | null;
  continuing?: boolean;
  askingAi?: boolean;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
  onAskAi?: (paths: string[]) => void | Promise<void>;
  onResolve: (path: string, choice: 'ours' | 'theirs') => void | Promise<void>;
  onContinue: () => void | Promise<void>;
}

function kindLabel(kind: StoAppConflictFile['kind']): string {
  switch (kind) {
    case 'binary':
      return '二进制';
    case 'add-delete':
      return '新增/删除';
    default:
      return '文本';
  }
}

export function StoAppConflictDialog({
  open,
  conflicts,
  busyPath = null,
  continuing = false,
  askingAi = false,
  onClose,
  onOpenFile,
  onAskAi,
  onResolve,
  onContinue,
}: StoAppConflictDialogProps) {
  if (!open) return null;

  const unresolved = conflicts.filter((item) => item.status !== 'resolved');
  const canContinue = unresolved.length === 0 && !continuing && !askingAi;
  const actionsDisabled = Boolean(busyPath) || continuing || askingAi;

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[color-mix(in_srgb,var(--sto-shadow-tone)_42%,transparent)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sto-app-conflict-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !actionsDisabled) onClose();
      }}
    >
      <div
        className={cn(
          'sto-card flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden rounded-[12px] border p-5',
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="sto-app-conflict-title" className="text-[16px] font-semibold text-foreground">
            处理代码冲突
          </h2>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
            disabled={actionsDisabled}
            aria-label="关闭"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          本地和远端都改过这些文件。可整文件保留本地或采用远端，也可打开文件改冲突标记，或交给 AI 处理后继续合并。
        </p>

        <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-auto">
          {unresolved.length === 0 ? (
            <li className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              冲突已处理完，可以继续合并。
            </li>
          ) : unresolved.map((item) => {
            const busy = busyPath === item.path;
            return (
              <li
                key={item.path}
                className="rounded-lg border border-border bg-background/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {onOpenFile ? (
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-medium text-foreground underline-offset-2 hover:underline"
                        title={`打开 ${item.path}`}
                        disabled={actionsDisabled}
                        onClick={() => onOpenFile(item.path)}
                      >
                        {item.path}
                      </button>
                    ) : (
                      <p className="truncate text-sm font-medium text-foreground" title={item.path}>
                        {item.path}
                      </p>
                    )}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {kindLabel(item.kind)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={actionsDisabled}
                      onClick={() => void onResolve(item.path, 'ours')}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '用我的'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={actionsDisabled}
                      onClick={() => void onResolve(item.path, 'theirs')}
                    >
                      用远端
                    </Button>
                    {onAskAi ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={actionsDisabled}
                        onClick={() => void onAskAi([item.path])}
                      >
                        {askingAi ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        )}
                        AI 处理
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={actionsDisabled}
            onClick={onClose}
          >
            稍后处理
          </Button>
          {onAskAi && unresolved.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={actionsDisabled}
              onClick={() => void onAskAi(unresolved.map((item) => item.path))}
            >
              {askingAi ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              交给 AI
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={!canContinue}
            onClick={() => void onContinue()}
          >
            {continuing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            继续合并
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
