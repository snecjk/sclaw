/**
 * AppDevTurnSummaryCard — 轮次汇总卡（P1 交互改造 T02）
 *
 * 每轮生成结束出现在该轮消息末尾：「已处理 N 个任务 · 耗时 Xs」，可展开逐任务明细；
 * 中断时显示「已中断 · 已完成 N 个任务」。
 *
 * T04 挂载点：`actions` 渲染于卡片头部右侧，用于挂 [恢复版本｜查看修改] 按钮。
 */
import { memo, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ListTodo } from 'lucide-react';
import type { ToolStatus } from '@/stores/chat';
import {
  describeAppDevTool,
  extractAppDevFileOpStat,
  formatAppDevDurationMs,
  rollupAppDevTools,
} from '@/lib/app-dev-tool-rollup';
import { cn } from '@/lib/utils';

export interface AppDevTurnSummaryCardProps {
  /** 本轮 completed 工具（durationMs 用于明细行耗时）。 */
  tools: readonly ToolStatus[];
  /** 轮次耗时（毫秒），null 时不显示耗时段。 */
  durationMs: number | null;
  /** 用户中断：标题改为「已中断 · 已完成 N 个任务」。 */
  interrupted?: boolean;
  /** T04 挂载点：版本操作按钮（恢复版本｜查看修改）。 */
  actions?: ReactNode;
  className?: string;
}

export const AppDevTurnSummaryCard = memo(function AppDevTurnSummaryCard({
  tools,
  durationMs,
  interrupted = false,
  actions,
  className,
}: AppDevTurnSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const rollup = useMemo(() => rollupAppDevTools(tools), [tools]);

  const taskCount = rollup.totals.completedTools;
  if (taskCount === 0 && !interrupted) return null;

  const title = interrupted
    ? `已中断 · 已完成 ${taskCount} 个任务`
    : `已处理 ${taskCount} 个任务`;

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-[var(--sto-surface-subtle)] px-3 py-2 text-xs',
        className,
      )}
      data-testid="app-dev-turn-summary"
    >
      <div className="flex items-center gap-2">
        <ListTodo className="h-3.5 w-3.5 shrink-0 text-[var(--sto-text-secondary)]" aria-hidden />
        <span className="text-foreground">{title}</span>
        {durationMs != null ? (
          <span className="text-[var(--sto-text-tertiary)]">
            · 耗时 {formatAppDevDurationMs(durationMs)}
          </span>
        ) : null}
        <span className="flex-1" />
        {actions}
        {taskCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? '收起明细' : '展开明细'}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--sto-text-tertiary)] transition-colors hover:bg-[var(--sto-control-hover-bg)] hover:text-foreground"
          >
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform duration-150', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
        ) : null}
      </div>

      {expanded && taskCount > 0 ? (
        <div
          className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5"
          data-testid="app-dev-turn-summary-details"
        >
          {tools
            .filter((tool) => tool.status === 'completed')
            .map((tool, index) => {
              const fileStat = extractAppDevFileOpStat(tool);
              return (
                <div
                  key={tool.toolCallId ?? tool.id ?? `${tool.name}-${index}`}
                  className="flex h-5 items-center gap-1.5 font-mono"
                >
                  <span className="truncate text-[var(--sto-text-secondary)]">
                    {describeAppDevTool(tool)}
                  </span>
                  {fileStat && (fileStat.added > 0 || fileStat.removed > 0) ? (
                    <span className="shrink-0 tabular-nums">
                      {fileStat.added > 0 ? (
                        <span className="text-[var(--sto-success-primary)]">+{fileStat.added}</span>
                      ) : null}
                      {fileStat.added > 0 && fileStat.removed > 0 ? ' ' : null}
                      {fileStat.removed > 0 ? (
                        <span className="text-[var(--sto-danger-primary)]">−{fileStat.removed}</span>
                      ) : null}
                    </span>
                  ) : null}
                  {typeof tool.durationMs === 'number' && tool.durationMs > 0 ? (
                    <span className="ml-auto shrink-0 tabular-nums text-[var(--sto-text-tertiary)]">
                      {formatAppDevDurationMs(tool.durationMs)}
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
});
