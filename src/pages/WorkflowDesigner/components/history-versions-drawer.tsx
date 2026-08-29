import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  listWorkflowHistoryVersions,
  restoreWorkflowHistoryVersion,
  type WorkflowHistoryVersion,
} from '@/lib/workflow-studio-api';
import type { WorkflowDefinition } from '@/pages/WorkflowDesigner/types';
import { cn } from '@/lib/utils';

interface HistoryVersionsDrawerProps {
  open: boolean;
  workflow: WorkflowDefinition | null;
  onClose: () => void;
  onRestored: (workflow: WorkflowDefinition) => void;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

function formatVersionTime(value?: string | null): string {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(date)
    .replace(/\//g, '/');
}

export function HistoryVersionsDrawer({
  open,
  workflow,
  onClose,
  onRestored,
}: HistoryVersionsDrawerProps) {
  const workflowId = workflow?.id ?? '';
  const [versions, setVersions] = useState<WorkflowHistoryVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadVersions = useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    try {
      const items = await listWorkflowHistoryVersions(workflowId);
      setVersions(items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '版本列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      void loadVersions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadVersions, open]);

  useEffect(() => {
    if (open) return undefined;
    const timer = window.setTimeout(() => {
      setVersions([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleRestore = async (version: WorkflowHistoryVersion) => {
    if (!workflowId) return;
    const ok = window.confirm(`确定恢复到 v${version.version}？当前未保存修改会被覆盖。`);
    if (!ok) return;
    setRestoringId(version.id);
    try {
      const restored = await restoreWorkflowHistoryVersion(workflowId, version.id);
      onRestored(restored);
      toast.success(`已恢复到 v${version.version}`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复版本失败');
    } finally {
      setRestoringId(null);
    }
  };

  if (!open) return null;

  return (
    <section className="absolute inset-y-0 right-0 z-[40] flex min-w-[620px] flex-col border-l border-slate-200 bg-white shadow-[-8px_0_24px_rgba(15,23,42,0.06)] dark:border-border dark:bg-[var(--sto-surface-primary)] dark:shadow-[-8px_0_24px_rgba(0,0,0,0.35)] sm:left-[96px]">
      <header className="flex h-[108px] shrink-0 items-center justify-between border-b border-slate-200 px-9 dark:border-border">
        <div className="flex items-center gap-3">
          <History className="h-6 w-6 text-slate-950 dark:text-[var(--sto-icon-primary)]" />
          <h2 className="text-[28px] font-extrabold leading-none text-slate-950 dark:text-[var(--sto-text-primary)]">版本列表</h2>
        </div>
        <button
          type="button"
          aria-label="关闭版本列表"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:text-[var(--sto-icon-tertiary)] dark:hover:bg-[var(--sto-surface-elevated)] dark:hover:text-[var(--sto-icon-secondary)]"
        >
          <X className="h-6 w-6" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-9 py-9">
        {loading && versions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-[var(--sto-text-tertiary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中
          </div>
        ) : null}
        {!loading && versions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-[var(--sto-text-tertiary)]">暂无历史版本</p>
        ) : null}
        <ol className="space-y-8">
          {versions.map((version, index) => {
            const isPublished = version.status.toLowerCase() === 'published';
            const isEditing = workflow?.version === version.version || version.isCurrent;
            const showRestore = !isEditing;
            return (
              <li key={version.id} className="group">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[23px] font-extrabold leading-none text-slate-950 dark:text-[var(--sto-text-primary)]">
                        v{version.version}
                      </span>
                      <VersionPill
                        className={isPublished ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-[var(--sto-surface-elevated)] dark:text-[var(--sto-text-tertiary)]'}
                      >
                        {STATUS_LABEL[version.status.toLowerCase()] ?? version.status}
                      </VersionPill>
                      {isPublished ? (
                        <VersionPill className="bg-orange-500 text-white">当前生效</VersionPill>
                      ) : null}
                      {isEditing ? (
                        <VersionPill className="bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300">当前编辑</VersionPill>
                      ) : null}
                      {showRestore ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-slate-500 opacity-0 transition group-hover:opacity-100 dark:text-[var(--sto-text-secondary)] dark:hover:bg-[var(--sto-surface-elevated)]"
                          disabled={restoringId === version.id}
                          onClick={() => void handleRestore(version)}
                        >
                          {restoringId === version.id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                          )}
                          恢复
                        </Button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="mt-6 block max-w-[520px] truncate text-left text-[21px] font-normal leading-none text-slate-500 underline underline-offset-4 hover:text-slate-700 dark:text-[var(--sto-text-secondary)] dark:hover:text-[var(--sto-text-primary)]"
                      onClick={() => {
                        if (showRestore) void handleRestore(version);
                      }}
                    >
                      {resolveVersionName(version, workflow, index)}
                    </button>
                  </div>
                  <time className="shrink-0 pt-1 text-[21px] font-semibold leading-none text-slate-400 dark:text-[var(--sto-text-tertiary)]">
                    {formatVersionTime(version.updatedAt ?? version.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function VersionPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-9 items-center rounded-full px-4 text-[17px] font-extrabold', className)}>
      {children}
    </span>
  );
}

function resolveVersionName(
  version: WorkflowHistoryVersion,
  workflow: WorkflowDefinition | null,
  index: number,
): string {
  const summaryName = version.summary?.split('·')[0]?.trim();
  if (summaryName) return summaryName;
  if (index === 0 && workflow?.name) return workflow.name;
  return `版本 v${version.version}`;
}
