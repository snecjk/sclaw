/**
 * AppDevTodoCapsule — composer 上方悬浮待办胶囊（P1 交互改造 T02）
 *
 * 生成中显示「当前任务名 · x/N」，点击展开三态清单（done ✓ / active spinner / pending 灰点）；
 * 轮结束 600ms 后淡出。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, Loader2 } from 'lucide-react';
import type { AppDevTurnPlan } from '@/lib/app-dev-turn-plan';
import { cn } from '@/lib/utils';

const FADE_OUT_DELAY_MS = 600;

interface AppDevTodoCapsuleProps {
  plan: AppDevTurnPlan;
  sending: boolean;
  className?: string;
}

export const AppDevTodoCapsule = memo(function AppDevTodoCapsule({
  plan,
  sending,
  className,
}: AppDevTodoCapsuleProps) {
  const [expanded, setExpanded] = useState(false);
  const [linger, setLinger] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 轮结束保留 600ms 再淡出
  useEffect(() => {
    if (sending || plan.totalCount === 0) return undefined;
    setLinger(true);
    timerRef.current = setTimeout(() => {
      setLinger(false);
      setExpanded(false);
    }, FADE_OUT_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sending, plan.totalCount]);

  if (plan.totalCount === 0) return null;
  if (!sending && !linger) return null;

  return (
    <div
      className={cn('pointer-events-none flex flex-col items-center', className)}
      data-testid="app-dev-todo-capsule"
    >
      {expanded ? (
        <div
          className="pointer-events-auto mb-2 w-[320px] max-w-[80vw] rounded-xl border border-border bg-popover p-2 shadow-[var(--sto-shadow-content-popover)] animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
          data-testid="app-dev-todo-capsule-list"
        >
          {plan.items.map((item) => (
            <div key={item.key} className="flex h-7 items-center gap-2 px-1 text-xs">
              {item.state === 'done' ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--sto-success-primary)]" aria-hidden />
              ) : item.state === 'active' ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--sto-brand-primary)]" aria-hidden />
              ) : (
                <span className="mx-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sto-text-tertiary)]" aria-hidden />
              )}
              <span
                className={cn(
                  'truncate',
                  item.state === 'pending' ? 'text-[var(--sto-text-tertiary)]' : 'text-foreground',
                )}
              >
                {item.title}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={cn(
          'pointer-events-auto flex h-8 max-w-[480px] items-center gap-2 rounded-full border border-border px-3 text-xs',
          'bg-[var(--sto-card-default-background)] shadow-[var(--sto-shadow-content-popover)] backdrop-blur-[var(--glass-blur)]',
          'transition-colors hover:bg-[var(--sto-control-hover-bg)]',
          'animate-in fade-in-0 slide-in-from-bottom-2 duration-200',
        )}
      >
        {sending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--sto-brand-primary)]" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-[var(--sto-success-primary)]" aria-hidden />
        )}
        <span className="truncate text-foreground">
          {sending ? (plan.activeTitle ?? '正在处理…') : '已完成'}
        </span>
        <span className="shrink-0 tabular-nums text-[var(--sto-text-tertiary)]">
          {plan.doneCount}/{plan.totalCount}
        </span>
        <ChevronUp
          className={cn(
            'h-3 w-3 shrink-0 text-[var(--sto-text-tertiary)] transition-transform duration-150',
            expanded && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
    </div>
  );
});
