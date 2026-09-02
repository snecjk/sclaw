import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TemplateImportPreview } from '../../../shared/app-template-source-import';

export interface TemplateProjectUploadDialogProps {
  open: boolean;
  preview: TemplateImportPreview;
  applying: boolean;
  onApply: () => void | Promise<void>;
  onCancel: () => void;
  onPickAnother: () => void;
}

const CHANGE_LABELS = {
  add: '新增',
  modify: '修改',
  delete: '删除',
} as const;

export function TemplateProjectUploadDialog({
  open,
  preview,
  applying,
  onApply,
  onCancel,
  onPickAnother,
}: TemplateProjectUploadDialogProps) {
  if (!open) return null;
  const counts = {
    add: preview.changes.filter((change) => change.kind === 'add').length,
    modify: preview.changes.filter((change) => change.kind === 'modify').length,
    delete: preview.changes.filter((change) => change.kind === 'delete').length,
  };
  const blockers = preview.issues.filter((issue) => issue.level === 'blocker');
  const warnings = preview.issues.filter((issue) => issue.level === 'warning');

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[rgba(15,23,42,0.42)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-project-upload-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !applying) onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !applying) onCancel();
      }}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="template-project-upload-title" className="text-base font-semibold">确认覆盖模板工作区</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            来源：{preview.sourceName} · React / Vite · {preview.pageType === 'site' ? 'Site' : 'Assets'}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {(['add', 'modify', 'delete'] as const).map((kind) => (
              <span
                key={kind}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  kind === 'delete'
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
                    : 'border-border bg-muted/50 text-muted-foreground',
                )}
              >
                {CHANGE_LABELS[kind]} {counts[kind]}
              </span>
            ))}
          </div>

          {preview.changes.length > 0 ? (
            <details open>
              <summary className="cursor-pointer text-xs font-medium">文件变更</summary>
              <div className="mt-2 max-h-44 overflow-auto rounded-md border border-border">
                {preview.changes.map((change) => (
                  <div key={`${change.kind}:${change.path}`} className="flex gap-3 border-b border-border/60 px-3 py-1.5 last:border-0">
                    <span className={cn('w-9 shrink-0 text-xs', change.kind === 'delete' && 'text-destructive')}>
                      {CHANGE_LABELS[change.kind]}
                    </span>
                    <code className="min-w-0 break-all text-xs text-foreground">{change.path}</code>
                  </div>
                ))}
              </div>
            </details>
          ) : <p className="text-xs text-muted-foreground">来源项目与当前模板没有文件差异。</p>}

          {preview.packageChanges.length > 0 ? (
            <section>
              <h3 className="text-xs font-medium">依赖与脚本处理</h3>
              <div className="mt-2 overflow-hidden rounded-md border border-border">
                {preview.packageChanges.map((change) => (
                  <div key={`${change.section}:${change.name}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-border/60 px-3 py-2 text-xs last:border-0">
                    <div>
                      <span className="font-medium">{change.name}</span>
                      <span className="ml-2 text-muted-foreground">{change.section}</span>
                    </div>
                    <span className="text-muted-foreground">使用 {change.appliedValue ?? change.resolution}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {preview.ignoredPaths.length > 0 ? (
            <section>
              <h3 className="text-xs font-medium">已忽略</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {preview.ignoredPaths.map((path) => (
                  <code key={path} className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{path}</code>
                ))}
              </div>
            </section>
          ) : null}

          {blockers.length > 0 || warnings.length > 0 ? (
            <section className="space-y-2">
              {[...blockers, ...warnings].map((issue, index) => (
                <div
                  key={`${issue.code}:${issue.path ?? index}`}
                  className={cn(
                    'flex gap-2 rounded-md border px-3 py-2 text-xs',
                    issue.level === 'blocker'
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
                      : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{issue.message}</span>
                </div>
              ))}
            </section>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <Button type="button" variant="ghost" size="sm" disabled={applying} onClick={onPickAnother}>
            选择其他目录
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={applying} onClick={onCancel}>
              取消
            </Button>
            <Button type="button" size="sm" disabled={applying || blockers.length > 0} onClick={() => void onApply()}>
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {applying ? '覆盖中…' : '确认覆盖'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
