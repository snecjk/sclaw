import { Check, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import {
  appDevSetupHeadline,
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

export function AppDevSetupProgress({
  phase,
  progress,
  detail,
}: {
  phase: AppDevPhase;
  progress: number;
  detail?: string;
}) {
  const steps = appDevSetupSteps(phase, detail);

  return (
    <div className="w-full max-w-[360px] text-left">
      <div className="mb-5 flex flex-col items-center text-center">
        <Loader2 className="mb-3 h-7 w-7 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">{appDevSetupHeadline(phase)}</p>
        <Progress value={progress} className="mt-3 h-1.5 w-full" />
      </div>

      <ol className="relative space-y-0 rounded-xl border border-border/80 bg-background/80 px-4 py-3">
        {steps.map((step, index) => (
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
              {step.hint ? (
                <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">{step.hint}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
        首次创建通常一两分钟。你可以先在左侧描述想做的功能。
      </p>
    </div>
  );
}
