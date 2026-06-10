import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowExecutionStep } from '@/types/workflow';

interface WorkflowExecutionStepsProps {
  steps: WorkflowExecutionStep[];
}

export function WorkflowExecutionSteps({ steps }: WorkflowExecutionStepsProps) {
  if (steps.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {steps.map((step, index) => (
        <div key={index} className="flex items-center gap-2 text-xs">
          {step.status === 'completed' && <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />}
          {step.status === 'running' && <Loader2 className="h-3 w-3 text-amber-500 shrink-0 animate-spin" />}
          {step.status === 'failed' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
          {step.status === 'pending' && <Circle className="h-3 w-3 text-slate-300 shrink-0" />}
          <span className={cn(
            step.status === 'completed' && 'text-green-600',
            step.status === 'running' && 'text-amber-600',
            step.status === 'failed' && 'text-red-600',
            step.status === 'pending' && 'text-muted-foreground',
          )}>
            {step.name}
            {step.duration && (
              <span className="text-muted-foreground ml-1">({(step.duration / 1000).toFixed(1)}s)</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
