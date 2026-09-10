/**
 * Plan 方案确认卡：一页看完需求与步骤，点选风格后确认开始。
 */
import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_APP_DEV_STYLE_PRESETS,
  planCardBrief,
  type AppDevPlanDocument,
  type AppDevStylePreset,
} from '@/lib/app-dev-plan-gate';
import { cn } from '@/lib/utils';

interface AppDevPlanCardProps {
  plan: AppDevPlanDocument;
  /** Agent 输出的风格预设；缺省用内置三套。 */
  stylePresets?: AppDevStylePreset[] | null;
  onConfirm: (plan: AppDevPlanDocument, style: AppDevStylePreset | null) => void;
  onDismiss?: () => void;
}

const MAX_VISIBLE_STEPS = 6;

export function AppDevPlanCard({
  plan,
  stylePresets,
  onConfirm,
  onDismiss,
}: AppDevPlanCardProps) {
  const presets = useMemo(
    () => (stylePresets && stylePresets.length > 0 ? stylePresets : DEFAULT_APP_DEV_STYLE_PRESETS),
    [stylePresets],
  );
  const [selectedStyleId, setSelectedStyleId] = useState(presets[0]?.id ?? '');
  const selectedStyle = presets.find((preset) => preset.id === selectedStyleId) ?? presets[0] ?? null;
  const brief = planCardBrief(plan);
  const visibleSteps = plan.steps.slice(0, MAX_VISIBLE_STEPS);
  const hiddenStepCount = plan.steps.length - visibleSteps.length;

  return (
    <div
      className="mt-2 rounded-xl border border-border bg-card p-3 text-xs shadow-sm"
      data-testid="app-dev-plan-card"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">方案待确认</span>
        <span className="text-[11px] text-muted-foreground">确认后开始制作</span>
      </div>

      {brief ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-foreground">{brief}</p>
      ) : null}

      <ol className="mt-2 space-y-1 text-xs leading-relaxed text-foreground">
        {visibleSteps.map((step, index) => (
          <li key={step.id || `step-${index}`} className="flex gap-2">
            <span className="w-4 shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
            <span className="min-w-0 line-clamp-1">{step.title}</span>
          </li>
        ))}
      </ol>
      {hiddenStepCount > 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">还有 {hiddenStepCount} 步，确认后按完整方案执行</p>
      ) : null}

      {presets.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] text-muted-foreground">风格</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => {
              const selected = preset.id === selectedStyle?.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors',
                    selected
                      ? 'border-[var(--sto-brand-primary)] bg-[var(--sto-bg-inset)] text-foreground'
                      : 'border-border text-muted-foreground hover:bg-[var(--sto-bg-inset)] hover:text-foreground',
                  )}
                  aria-pressed={selected}
                  onClick={() => setSelectedStyleId(preset.id)}
                >
                  {preset.swatches.slice(0, 3).map((color) => (
                    <span
                      key={`${preset.id}-${color}`}
                      className="h-2.5 w-2.5 rounded-full border border-[var(--sto-border-default)]"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                  {preset.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {onDismiss ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
            忽略方案
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={() => onConfirm(plan, selectedStyle)}
        >
          <Check className="h-3.5 w-3.5" />
          确认开始
        </Button>
      </div>
    </div>
  );
}
