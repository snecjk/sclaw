/**
 * AppDevToolRollupLine — 生成过程工具聚合摘要行（P1 交互改造 T02）
 *
 * 对话流中实时滚动「编辑 home.page.json +26 −60」「执行 pnpm run build」，
 * 增删行数红绿着色（--sto-success-primary / --sto-danger-primary）。
 */
import { memo } from 'react';
import { FileEdit, FilePlus2, Search, Terminal, Wrench } from 'lucide-react';
import {
  appDevFileOpVerb,
  appDevToolBaseName,
  type AppDevToolRollup,
} from '@/lib/app-dev-tool-rollup';
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
        return (
          <div
            key={file.path}
            className="flex h-5 items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-150"
          >
            <Icon className="h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)]" aria-hidden />
            <span className="text-[var(--sto-text-secondary)]">{appDevFileOpVerb(file)}</span>
            <span className="truncate text-foreground" title={file.path}>
              {appDevToolBaseName(file.path)}
            </span>
            <DiffCounts added={file.added} removed={file.removed} />
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
