import { ChevronDown, Play, RotateCw, Square } from 'lucide-react';
import type { AppDevPhase } from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const APP_DEV_PHASE_LABELS: Record<AppDevPhase, string> = {
  created: '正在准备运行环境…',
  'preparing-env': '正在准备运行环境…',
  'checking-snpm': '正在检测 snpm…',
  installing: '正在执行依赖…',
  starting: '正在执行启动…',
  ready: '运行中',
  stopped: '已停止',
  error: '出了点问题',
};

interface AppDevRunStatusMenuProps {
  phase: AppDevPhase;
  pending?: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  className?: string;
}

export function AppDevRunStatusMenu({
  phase,
  pending = false,
  onStart,
  onStop,
  onRestart,
  className,
}: AppDevRunStatusMenuProps) {
  const running = phase === 'ready';
  const working = pending
    || phase === 'created'
    || phase === 'preparing-env'
    || phase === 'checking-snpm'
    || phase === 'installing'
    || phase === 'starting';
  const canStart = phase === 'stopped' || phase === 'error';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={working}>
        <button
          type="button"
          className={cn(
            'no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground',
            !working && 'transition-colors hover:bg-muted hover:text-foreground',
            working && 'cursor-default',
            className,
          )}
          aria-label={`应用状态：${APP_DEV_PHASE_LABELS[phase]}`}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              running && 'bg-[var(--sto-functional-success)]',
              working && 'bg-[var(--sto-functional-warning)]',
              phase === 'error' && 'bg-[var(--sto-functional-error)]',
              phase === 'stopped' && 'bg-muted-foreground/50',
            )}
            aria-hidden
          />
          {APP_DEV_PHASE_LABELS[phase]}
          {!working ? <ChevronDown className="h-3 w-3" aria-hidden /> : null}
        </button>
      </DropdownMenuTrigger>
      {/* App plaza renders the workbench in a portal at z-index 240. */}
      <DropdownMenuContent align="end" className="z-[260] min-w-[132px]">
        {running ? (
          <>
            <DropdownMenuItem onSelect={onRestart}>
              <RotateCw className="mr-2 h-3.5 w-3.5" aria-hidden />
              重新启动
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={onStop}
            >
              <Square className="mr-2 h-3.5 w-3.5" aria-hidden />
              停止
            </DropdownMenuItem>
          </>
        ) : null}
        {canStart ? (
          <DropdownMenuItem onSelect={onStart}>
            <Play className="mr-2 h-3.5 w-3.5" aria-hidden />
            启动
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
