/**
 * AppDevToolRollupLine — 生成过程工具聚合摘要行（P1 交互改造 T02）
 *
 * 对话流中实时滚动「编辑 home.page.json +26 −60」「执行 pnpm run build」，
 * 增删行数红绿着色；有 edits 时可展开轻量逐行 diff（P5 W1-2）。
 */
import { memo, useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, FileEdit, FilePlus2, Search, Terminal, Wrench } from 'lucide-react';
import {
  appDevFileOpVerb,
  appDevToolBaseName,
  type AppDevToolRollup,
} from '@/lib/app-dev-tool-rollup';
import { AppDevInlineDiff } from '@/components/app-dev/AppDevInlineDiff';
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
    <span className="tabular-nums">
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

  if (rollup.totals.completedTools === 0) return null;

  const files = rollup.files.slice(0, MAX_FILE_ROWS);
  const overflowFiles = rollup.files.length - files.length;
  const commands = rollup.commands.slice(0, MAX_COMMAND_ROWS);
  const overflowCommands = rollup.commands.length - commands.length;

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
            <button
              type="button"
              className={cn(
                'flex h-5 items-center gap-1.5 text-left animate-in fade-in-0 slide-in-from-bottom-1 duration-150',
                canExpand
                  ? 'cursor-pointer rounded-sm hover:bg-[var(--sto-bg-inset)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--sto-border-strong)]'
                  : 'cursor-default',
              )}
              disabled={!canExpand}
              aria-expanded={canExpand ? expanded : undefined}
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
              <span className="text-[var(--sto-text-secondary)]">{appDevFileOpVerb(file)}</span>
              <span className="truncate text-foreground" title={file.path}>
                {appDevToolBaseName(file.path)}
              </span>
              <DiffCounts added={file.added} removed={file.removed} />
            </button>
            {canExpand && expanded ? <AppDevInlineDiff edits={file.edits} /> : null}
          </div>
        );
      })}
      {overflowFiles > 0 ? (
        <div className="flex h-5 items-center gap-1.5 text-[var(--sto-text-tertiary)]">
          … 另 {overflowFiles} 个文件
        </div>
      ) : null}
      {commands.map((command, index) => (
        <div
          key={`${command.cmd}-${index}`}
          className="flex h-5 items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150"
        >
          <Terminal className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
          <span className="text-[var(--sto-text-secondary)]">执行</span>
          <span className="truncate text-foreground">{command.cmd}</span>
        </div>
      ))}
      {overflowCommands > 0 ? (
        <div className="flex h-5 items-center gap-1.5 text-[var(--sto-text-tertiary)]">
          … 另 {overflowCommands} 条命令
        </div>
      ) : null}
      {rollup.reads > 0 ? (
        <div className="flex h-5 items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150">
          <Search className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
          <span className="text-[var(--sto-text-secondary)]">读取/检索 {rollup.reads} 次</span>
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
