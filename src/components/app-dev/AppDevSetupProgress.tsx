import { useEffect, useRef } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  appDevSetupHeadline,
  appDevSetupLogStepId,
  appDevSetupSteps,
  type AppDevSetupStep,
} from '@/lib/app-dev-pipeline';
import type { AppDevPhase } from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';

function StepGlyph({ state }: { state: AppDevSetupStep['state'] }) {
  if (state === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--sto-brand-primary,#F97316)]/12 ring-2 ring-[var(--sto-brand-primary,#F97316)]">
        <Loader2 className="h-3 w-3 animate-spin text-[var(--sto-brand-primary,#F97316)]" aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background" />
  );
}

export function AppDevCommandLog({ log, className }: { log?: string; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const text = log?.trim() ?? '';

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  if (!text) return null;
  return (
    <pre
      ref={ref}
      className={cn(
        'max-h-48 overflow-auto rounded-lg border border-border bg-[var(--sto-form-inset-background)] px-3 py-2 text-left font-mono text-[11px] leading-5 text-[var(--sto-text-secondary)] whitespace-pre-wrap break-all',
        className,
      )}
    >
      {text}
    </pre>
  );
}

export function AppDevSetupProgress({
  phase,
  progress,
  detail,
  log,
  onCancel,
}: {
  phase: AppDevPhase;
  progress: number;
  detail?: string;
  log?: string;
  onCancel?: () => void;
}) {
  const steps = appDevSetupSteps(phase, detail);
  const logText = log?.trim() ?? '';
  const logStepId = appDevSetupLogStepId(phase);

  return (
    <div className="w-full max-w-[480px] text-left">
      <div className="mb-5 flex flex-col items-center text-center">
        <Loader2 className="mb-3 h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">{appDevSetupHeadline(phase)}</p>
        <Progress value={progress} className="mt-3 h-1.5 w-full" />
      </div>

      <ol className="relative space-y-0 rounded-xl border border-border/80 bg-background/80 px-4 py-3">
        {steps.map((step, index) => {
          const showLog = logStepId === step.id;
          return (
            <li key={step.id} className="relative flex gap-3 py-2.5">
              {index < steps.length - 1 ? (
                <span
                  className={cn(
                    'absolute left-[9px] top-8 h-[calc(100%-8px)] w-px',
                    step.state === 'done' ? 'bg-emerald-400/70' : 'bg-border',
                  )}
                  aria-hidden
                />
              ) : null}
              <StepGlyph state={step.state} />
              <div className="min-w-0 flex-1 pt-px">
                <p
                  className={cn(
                    'text-[13px] leading-5',
                    step.state === 'active' && 'font-medium text-foreground',
                    step.state === 'done' && 'text-foreground/80',
                    step.state === 'pending' && 'text-muted-foreground',
                  )}
                >
                  {step.title}
                </p>
                {showLog && (logText || step.hint) ? (
                  <AppDevCommandLog log={logText || step.hint} className="mt-1 max-h-[6.25rem] py-1" />
                ) : step.hint ? (
                  <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{step.hint}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        首次创建通常一两分钟。你可以先在左侧描述想做的功能。
      </p>
      {onCancel ? (
        <div className="mt-3 flex justify-center">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancel}>
            取消
          </Button>
        </div>
      ) : null}
    </div>
  );
}
