/**
 * AppDevToolRollupLine — 生成过程工具聚合摘要行（P1 交互改造 T02）
 *
 * 对照 Cursor Agent：文件行只挂文件名 + 红绿增删；命令收进 `$` 终端块；
 * 读取/检索不展示。有 edits 时可展开轻量逐行 diff（P5 W1-2）。
 */
import { memo, useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, FileEdit, FilePlus2, Terminal, Wrench } from 'lucide-react';
import {
  appDevFileOpVerb,
  appDevToolBaseName,
  type AppDevToolRollup,
} from '@/lib/app-dev-tool-rollup';
import { AppDevInlineDiff } from '@/components/app-dev/AppDevInlineDiff';
import { AppDevFileJumpLink } from '@/components/app-dev/AppDevFileJumpLink';
import { cn } from '@/lib/utils';

const MAX_FILE_ROWS = 5;
const MAX_COMMAND_ROWS = 3;

interface AppDevToolRollupLineProps {
  rollup: AppDevToolRollup;
  className?: string;
}

function DiffCounts({ added, removed }: { added: number; removed: number }) {
  if (added <= 0 && removed <= 0) return null;
  return (
    <span className="ml-auto shrink-0 tabular-nums">
      {added > 0 ? (
        <span className="text-[var(--sto-success-primary)]">+{added}</span>
      ) : null}
      {added > 0 && removed > 0 ? ' ' : null}
      {removed > 0 ? (
        <span className="text-[var(--sto-danger-primary)]">−{removed}</span>
      ) : null}
    </span>
  );
}

export const AppDevToolRollupLine = memo(function AppDevToolRollupLine({
  rollup,
  className,
}: AppDevToolRollupLineProps) {
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const files = rollup.files.slice(-MAX_FILE_ROWS);
  const overflowFiles = rollup.files.length - files.length;
  const commands = rollup.commands.slice(-MAX_COMMAND_ROWS);
  const overflowCommands = rollup.commands.length - commands.length;
  const hasVisibleRows =
    files.length > 0
    || overflowFiles > 0
    || commands.length > 0
    || overflowCommands > 0
    || rollup.others > 0;

  if (!hasVisibleRows) return null;

  return (
    <div
      className={cn('flex flex-col gap-0.5 text-xs font-mono', className)}
      data-testid="app-dev-tool-rollup"
    >
      {files.map((file) => {
        const isCreate = file.hasCreate && !file.hasEdit;
        const Icon = isCreate ? FilePlus2 : FileEdit;
        const canExpand = file.edits.length > 0;
        const expanded = Boolean(expandedPaths[file.path]);
        return (
          <div key={file.path} className="flex flex-col">
            <div
              className={cn(
                'flex h-5 w-full items-center gap-1.5 text-left animate-in fade-in-0 slide-in-from-bottom-1 duration-150',
                canExpand && 'rounded-sm hover:bg-[var(--sto-control-hover-bg)]',
              )}
            >
              <button
                type="button"
                className={cn(
                  'inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-sm',
                  canExpand
                    ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sto-border-strong)]'
                    : 'cursor-default',
                )}
                disabled={!canExpand}
                aria-expanded={canExpand ? expanded : undefined}
                aria-label={canExpand ? (expanded ? `收起 ${appDevToolBaseName(file.path)} 的修改` : `展开 ${appDevToolBaseName(file.path)} 的修改`) : undefined}
                onClick={() => {
                  if (canExpand) togglePath(file.path);
                }}
              >
                {canExpand ? (
                  expanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
                  )
                ) : (
                  <Icon className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
                )}
              </button>
              <span className="text-[var(--sto-text-secondary)]">{appDevFileOpVerb(file)}</span>
              <AppDevFileJumpLink path={file.path}>
                {appDevToolBaseName(file.path)}
              </AppDevFileJumpLink>
              <DiffCounts added={file.added} removed={file.removed} />
            </div>
            {canExpand && expanded ? <AppDevInlineDiff edits={file.edits} /> : null}
          </div>
        );
      })}
      {overflowFiles > 0 ? (
        <div className="flex h-5 items-center gap-1.5 text-[var(--sto-text-tertiary)]">
          … 另 {overflowFiles} 个文件
        </div>
      ) : null}
      {commands.length > 0 || overflowCommands > 0 ? (
        <div
          className="mt-0.5 overflow-hidden rounded-md border border-[var(--sto-border-default)] bg-[var(--sto-bg-inset)] px-2 py-1"
          data-testid="app-dev-tool-rollup-commands"
        >
          {commands.map((command, index) => (
            <div
              key={`${command.cmd}-${index}`}
              className="flex h-5 items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150"
            >
              <Terminal className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
              <span className="shrink-0 text-[var(--sto-text-tertiary)]">$</span>
              <span className="truncate text-foreground" title={command.cmd}>{command.cmd}</span>
            </div>
          ))}
          {overflowCommands > 0 ? (
            <div className="flex h-5 items-center gap-1.5 text-[var(--sto-text-tertiary)]">
              … 另 {overflowCommands} 条命令
            </div>
          ) : null}
        </div>
      ) : null}
      {rollup.others > 0 ? (
        <div className="flex h-5 items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <Wrench className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
          <span className="text-[var(--sto-text-secondary)]">其他 {rollup.others} 项操作</span>
        </div>
      ) : null}
    </div>
  );
});
