import { useCallback, useEffect, useState } from 'react';
import { GitCompareArrows, RotateCcw, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  getBuiltinTemplateDebugStatus,
  resetBuiltinTemplateDebugWorkspace,
  syncBuiltinTemplateDebugWorkspace,
  type BuiltinTemplateDebugStatus,
} from '@/lib/app-dev-api';

const CHANGE_LABEL = { add: '新增', modify: '修改', delete: '删除' } as const;

export function BuiltinTemplateDebugControl({
  workspaceId,
  onReloaded,
  onStatusChange,
}: {
  workspaceId: string;
  onReloaded: () => void;
  onStatusChange?: (isBuiltinDebug: boolean | null) => void;
}) {
  const [status, setStatus] = useState<BuiltinTemplateDebugStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'sync' | 'reset' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getBuiltinTemplateDebugStatus(workspaceId);
      setStatus(next.isBuiltinDebug ? next : null);
      onStatusChange?.(next.isBuiltinDebug);
    } catch {
      setStatus(null);
      onStatusChange?.(null);
    }
  }, [onStatusChange, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void getBuiltinTemplateDebugStatus(workspaceId)
      .then((next) => {
        if (cancelled) return;
        setStatus(next.isBuiltinDebug ? next : null);
        onStatusChange?.(next.isBuiltinDebug);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
        onStatusChange?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onStatusChange, workspaceId]);

  if (!status) return null;

  const runAction = async () => {
    if (confirmAction === 'sync') {
      const result = await syncBuiltinTemplateDebugWorkspace(workspaceId);
      toast.success(result.changedFiles.length > 0 ? '已同步回内置模板' : '没有需要同步的改动');
    } else if (confirmAction === 'reset') {
      await resetBuiltinTemplateDebugWorkspace(workspaceId);
      onReloaded();
      toast.success('已重新加载内置模板');
    }
    setConfirmAction(null);
    setOpen(false);
    await refresh();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => {
          void refresh();
          setOpen(true);
        }}
      >
        <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
        内置差异 {status.changes.length}
      </Button>

      {open ? createPortal(
        <div className="fixed inset-0 z-[255] flex items-center justify-center bg-black/45 p-6" role="dialog" aria-modal="true" aria-labelledby="builtin-template-debug-title">
          <section className="flex max-h-[70vh] w-[min(680px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
            <header className="flex items-center gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id="builtin-template-debug-title" className="text-base font-semibold">内置模板调试差异</h2>
                <p className="mt-1 text-xs text-muted-foreground">{status.templateId} · {status.pageType}</p>
              </div>
              <button type="button" aria-label="关闭内置模板差异" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {status.sourceChanged ? (
                <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                  内置源码已发生变化，请先重新加载。
                </p>
              ) : null}
              {status.changes.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">调试工作区与内置源码一致</p>
              ) : (
                <ul className="space-y-1.5">
                  {status.changes.map((change) => (
                    <li key={change.path} className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2 text-xs">
                      <span className="w-8 text-muted-foreground">{CHANGE_LABEL[change.kind]}</span>
                      <code className="min-w-0 flex-1 truncate">{change.path}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmAction('reset')}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />重新加载
              </Button>
              {!status.sourceChanged ? (
                <Button type="button" size="sm" onClick={() => setConfirmAction('sync')}>
                  同步回内置模板
                </Button>
              ) : null}
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}

      <ConfirmDialog
        open={confirmAction !== null}
        overlayClassName="z-[260]"
        title={confirmAction === 'sync' ? '同步回内置模板' : '重新加载内置模板'}
        message={confirmAction === 'sync'
          ? '将用当前调试工作区覆盖 resources 中的内置模板源码。'
          : '将放弃当前调试改动，重新从 resources 加载内置模板。'}
        confirmLabel={confirmAction === 'sync' ? '确认同步' : '确认重新加载'}
        confirmingLabel={confirmAction === 'sync' ? '同步中…' : '加载中…'}
        variant={confirmAction === 'reset' ? 'destructive' : 'default'}
        onConfirm={runAction}
        onCancel={() => setConfirmAction(null)}
        onError={(error) => toast.error(error instanceof Error ? error.message : '操作失败')}
      />
    </>
  );
}
