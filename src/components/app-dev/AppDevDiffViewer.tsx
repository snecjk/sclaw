/**
 * AppDevDiffViewer — 工作台「版本」页：某轮 checkpoint 的行级 diff（P1 交互改造 T04）。
 *
 * 消费 workbench store 的 diffRequest（请求-消费模式，处理后置 null）；
 * 左侧 240px 变更文件清单（M/A/D 徽章 + +N −M，复用代码页侧栏模式），
 * 右侧 Monaco DiffEditor 双栏红绿对比（readOnly + 未改动区折叠）；
 * 二进制/超大文件只显示统计不渲染编辑器。T10：支持 baseHash 任意两版对比。
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { FileWarning, History, Loader2 } from 'lucide-react';
import { diffAppCheckpoint, type AppCheckpointDiff, type AppCheckpointDiffFile } from '@/lib/app-dev-api';
import { ensureMonacoConfigured, languageFromPath } from '@/lib/monaco-setup';
import { useMonacoColorTheme } from '@/components/app-dev/use-monaco-theme';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { cn } from '@/lib/utils';

const STATUS_BADGE_CLASS: Record<AppCheckpointDiffFile['status'], string> = {
  M: 'text-[var(--sto-toast-warning-icon)]',
  A: 'text-[var(--sto-success-primary)]',
  D: 'text-[var(--sto-danger-primary)]',
};

function DiffFileStat({ file }: { file: AppCheckpointDiffFile }) {
  if (file.binary) {
    return <span className="text-[var(--sto-text-tertiary)]">二进制</span>;
  }
  return (
    <span className="tabular-nums">
      {file.added != null && file.added > 0 ? (
        <span className="text-[var(--sto-success-primary)]">+{file.added}</span>
      ) : null}
      {file.added != null && file.added > 0 && file.removed != null && file.removed > 0 ? ' ' : null}
      {file.removed != null && file.removed > 0 ? (
        <span className="text-[var(--sto-danger-primary)]">−{file.removed}</span>
      ) : null}
    </span>
  );
}

export const AppDevDiffViewer = memo(function AppDevDiffViewer({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const diffRequest = useAppDevWorkbenchStore((s) => s.diffRequest);
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const [activeBaseHash, setActiveBaseHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<AppCheckpointDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [monacoReady, setMonacoReady] = useState(false);
  const theme = useMonacoColorTheme();

  useEffect(() => {
    ensureMonacoConfigured();
    setMonacoReady(true);
  }, []);

  // 请求-消费：汇总卡「查看修改」/ 时间线对比 → 这里接管 hash 并清空请求。
  useEffect(() => {
    if (!diffRequest) return;
    setActiveHash(diffRequest.hash);
    setActiveBaseHash(diffRequest.baseHash?.trim() || null);
    useAppDevWorkbenchStore.getState().setDiffRequest(null);
  }, [diffRequest]);

  useEffect(() => {
    if (!activeHash || !workspaceId) return;
    let alive = true;
    setLoading(true);
    setFailed(false);
    void diffAppCheckpoint(workspaceId, activeHash, activeBaseHash ?? undefined)
      .then((result) => {
        if (!alive) return;
        setDiff(result);
        setFailed(!result);
        // 默认选中第一个可展示内容的文件；保留仍存在的旧选择。
        setSelectedPath((prev) => {
          if (prev && result?.files.some((file) => file.path === prev)) return prev;
          return result?.files.find((file) => !file.binary && !file.truncated)?.path
            ?? result?.files[0]?.path
            ?? null;
        });
      })
      .catch(() => {
        if (!alive) return;
        setDiff(null);
        setFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, activeHash, activeBaseHash]);

  const selectedFile = useMemo(
    () => diff?.files.find((file) => file.path === selectedPath) ?? null,
    [diff, selectedPath],
  );

  if (!activeHash) {
    return (
      <div
        className={cn('flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center', className)}
        data-testid="app-dev-diff-empty"
      >
        <History className="h-9 w-9 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">版本对比</p>
        <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
          在左侧时间线选择版本，或在对话汇总卡点击「查看修改」；勾选两个版本可对比任意区间。
        </p>
      </div>
    );
  }

  if (loading && !diff) {
    return (
      <div
        className={cn('flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground', className)}
        data-testid="app-dev-diff-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        正在读取版本差异…
      </div>
    );
  }

  if (failed || !diff) {
    return (
      <div
        className={cn('flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center', className)}
        data-testid="app-dev-diff-error"
      >
        <FileWarning className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">无法读取该版本的差异</p>
        <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
          该版本可能已被清理，或 Git 暂不可用。
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      data-testid="app-dev-diff-viewer"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="min-w-0 truncate text-foreground" title={diff.subject}>
          {diff.subject || '版本差异'}
        </span>
        <span className="shrink-0 font-mono text-[var(--sto-text-tertiary)]">
          {diff.parentHash ? `${diff.parentHash.slice(0, 7)} → ${diff.hash.slice(0, 7)}` : `${diff.hash.slice(0, 7)}（首个版本）`}
        </span>
        <span className="flex-1" />
        <span className="shrink-0 text-[var(--sto-text-tertiary)]">{diff.files.length} 个文件</span>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="w-60 shrink-0 overflow-y-auto border-r border-border py-1"
          data-testid="app-dev-diff-file-list"
        >
          {diff.files.map((file) => (
            <button
              key={file.path}
              type="button"
              aria-pressed={file.path === selectedPath}
              className={cn(
                'flex h-8 w-full items-center gap-1.5 px-2 text-left text-xs font-mono transition-colors',
                file.path === selectedPath
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-[var(--sto-text-secondary)] hover:bg-[var(--sto-control-hover-bg)] hover:text-foreground',
              )}
              title={file.path}
              onClick={() => setSelectedPath(file.path)}
            >
              <span className={cn('w-3 shrink-0 text-center font-semibold', STATUS_BADGE_CLASS[file.status])}>
                {file.status}
              </span>
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="shrink-0">
                <DiffFileStat file={file} />
              </span>
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden" data-testid="app-dev-diff-editor">
          {selectedFile ? (
            selectedFile.binary || selectedFile.truncated ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <FileWarning className="h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-foreground">
                  {selectedFile.binary ? '二进制文件，仅显示变更统计' : '文件过大，仅显示变更统计'}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{selectedFile.path}</p>
              </div>
            ) : monacoReady ? (
              <DiffEditor
                original={selectedFile.original ?? ''}
                modified={selectedFile.modified ?? ''}
                language={languageFromPath(selectedFile.path)}
                originalModelPath={`inmemory://app-dev-diff/${diff.parentHash ?? 'empty'}/${selectedFile.path}`}
                modifiedModelPath={`inmemory://app-dev-diff/${diff.hash}/${selectedFile.path}`}
                theme={theme}
                options={{
                  renderSideBySide: true,
                  hideUnchangedRegions: { enabled: true },
                  readOnly: true,
                  originalEditable: false,
                  minimap: { enabled: false },
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  padding: { top: 8, bottom: 8 },
                }}
                loading={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    正在加载编辑器…
                  </div>
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                正在加载编辑器…
              </div>
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择左侧文件查看差异
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
