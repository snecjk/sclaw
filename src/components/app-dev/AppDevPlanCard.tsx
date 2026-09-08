/**
 * Plan 方案确认卡（T12 + P5 W2）：1/3 需求 → 2/3 风格 → 3/3 素材确认 + 倒计时自动开始。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DEFAULT_APP_DEV_STYLE_PRESETS,
  type AppDevPlanDocument,
  type AppDevStylePreset,
} from '@/lib/app-dev-plan-gate';
import { cn } from '@/lib/utils';

interface AppDevPlanCardProps {
  plan: AppDevPlanDocument;
  /** Agent 输出的风格预设；缺省用内置三套。 */
  stylePresets?: AppDevStylePreset[] | null;
  /** 是否启用倒计时自动确认（仅在最后一步）。 */
  autoStartSeconds?: number;
  onConfirm: (plan: AppDevPlanDocument, style: AppDevStylePreset | null) => void;
  onDismiss?: () => void;
}

const STEP_LABELS = ['确认需求方案', '选择设计风格', '制作素材'] as const;

export function AppDevPlanCard({
  plan,
  stylePresets,
  autoStartSeconds = 15,
  onConfirm,
  onDismiss,
}: AppDevPlanCardProps) {
  const presets = useMemo(
    () => (stylePresets && stylePresets.length > 0 ? stylePresets : DEFAULT_APP_DEV_STYLE_PRESETS),
    [stylePresets],
  );

  const [wizardStep, setWizardStep] = useState(0);
  const [summary, setSummary] = useState(plan.summary);
  const [overview, setOverview] = useState(plan.overview ?? '');
  const [audience, setAudience] = useState(plan.audience ?? '');
  const [scenarios, setScenarios] = useState(plan.scenarios ?? '');
  const [stepsText, setStepsText] = useState(
    plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'),
  );
  const [selectedStyleId, setSelectedStyleId] = useState(presets[0]?.id ?? '');
  const [secondsLeft, setSecondsLeft] = useState(autoStartSeconds);
  const [paused, setPaused] = useState(false);

  const assetLines = useMemo(() => {
    const fromSteps = plan.steps.flatMap((s) => s.assets ?? []);
    if (fromSteps.length > 0) return fromSteps;
    return ['首页主视觉占位图', '列表空态插画（可选）'];
  }, [plan.steps]);

  useEffect(() => {
    setSummary(plan.summary);
    setOverview(plan.overview ?? '');
    setAudience(plan.audience ?? '');
    setScenarios(plan.scenarios ?? '');
    setStepsText(plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'));
    setWizardStep(0);
    setSelectedStyleId(presets[0]?.id ?? '');
    setSecondsLeft(autoStartSeconds);
    setPaused(false);
  }, [plan, autoStartSeconds, presets]);

  useEffect(() => {
    if (wizardStep !== 2 || paused || autoStartSeconds <= 0) return;
    if (secondsLeft <= 0) {
      handleConfirm();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟倒计时走
  }, [secondsLeft, paused, autoStartSeconds, wizardStep]);

  const buildPlan = (): AppDevPlanDocument => {
    const lines = stepsText
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.\u3001)]\s*/, '').trim())
      .filter(Boolean);
    return {
      summary: summary.trim() || plan.summary,
      overview: overview.trim() || undefined,
      audience: audience.trim() || undefined,
      scenarios: scenarios.trim() || undefined,
      steps: (lines.length > 0 ? lines : plan.steps.map((s) => s.title)).map((title, i) => ({
        id: plan.steps[i]?.id ?? String(i + 1),
        title,
        fileHints: plan.steps[i]?.fileHints,
        assets: plan.steps[i]?.assets,
      })),
    };
  };

  const handleConfirm = () => {
    const style = presets.find((p) => p.id === selectedStyleId) ?? presets[0] ?? null;
    onConfirm(buildPlan(), style);
  };

  const pauseOnEdit = () => setPaused(true);

  return (
    <div
      className="mt-2 rounded-xl border border-border bg-card p-3 text-xs shadow-sm"
      data-testid="app-dev-plan-card"
      onPointerDown={() => {
        if (wizardStep === 2) setPaused(true);
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">方案待确认</span>
        <span className="rounded-full bg-[var(--sto-bg-inset)] px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {wizardStep + 1}/{STEP_LABELS.length}
        </span>
        <span className="text-[11px] text-muted-foreground">{STEP_LABELS[wizardStep]}</span>
        <span className="flex-1" />
        {wizardStep === 2 && autoStartSeconds > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? '已暂停' : `${secondsLeft}s 后自动开始`}
          </button>
        ) : null}
      </div>

      {wizardStep === 0 ? (
        <div className="space-y-2">
          <Field label="应用概述">
            <textarea
              className="min-h-[52px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
              value={overview}
              placeholder="一句话说明应用是做什么的"
              onChange={(e) => {
                pauseOnEdit();
                setOverview(e.target.value);
              }}
            />
          </Field>
          <Field label="目标用户">
            <textarea
              className="min-h-[40px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
              value={audience}
              placeholder="谁会用"
              onChange={(e) => {
                pauseOnEdit();
                setAudience(e.target.value);
              }}
            />
          </Field>
          <Field label="核心场景">
            <textarea
              className="min-h-[52px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
              value={scenarios}
              placeholder="主要解决什么问题"
              onChange={(e) => {
                pauseOnEdit();
                setScenarios(e.target.value);
              }}
            />
          </Field>
          <Field label="需求说明">
            <textarea
              className="min-h-[64px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
              value={summary}
              onChange={(e) => {
                pauseOnEdit();
                setSummary(e.target.value);
              }}
            />
          </Field>
          <Field label="步骤清单">
            <textarea
              className="min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs leading-relaxed"
              value={stepsText}
              onChange={(e) => {
                pauseOnEdit();
                setStepsText(e.target.value);
              }}
            />
          </Field>
        </div>
      ) : null}

      {wizardStep === 1 ? (
        <div className="grid gap-2">
          {presets.map((preset) => {
            const selected = preset.id === selectedStyleId;
            return (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  selected
                    ? 'border-[var(--sto-brand-primary)] bg-[var(--sto-bg-inset)]'
                    : 'border-border hover:bg-[var(--sto-bg-inset)]',
                )}
                onClick={() => {
                  setPaused(true);
                  setSelectedStyleId(preset.id);
                }}
              >
                <div className="flex shrink-0 gap-1 pt-0.5">
                  {preset.swatches.slice(0, 4).map((color) => (
                    <span
                      key={`${preset.id}-${color}`}
                      className="h-4 w-4 rounded-full border border-[var(--sto-border-default)]"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">{preset.name}</div>
                  {preset.description ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{preset.description}</div>
                  ) : null}
                </div>
                {selected ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sto-brand-primary)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {wizardStep === 2 ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            本轮先用占位图占位，确认后开始写码；真实素材生成能力后续接入。
          </p>
          <ul className="rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground">
            {assetLines.map((line) => (
              <li key={line} className="list-disc py-0.5 pl-1 marker:text-muted-foreground">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            也可在下方输入框随时插话调整方案。
          </p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {onDismiss ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
            忽略方案
          </Button>
        ) : null}
        <span className="flex-1" />
        {wizardStep > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setPaused(true);
              setWizardStep((s) => Math.max(0, s - 1));
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一步
          </Button>
        ) : null}
        {wizardStep < 2 ? (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setPaused(true);
              setWizardStep((s) => Math.min(2, s + 1));
              if (wizardStep === 1) setSecondsLeft(autoStartSeconds);
            }}
          >
            下一步
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={handleConfirm}>
            <Check className="h-3.5 w-3.5" />
            确认计划，开始制作
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
