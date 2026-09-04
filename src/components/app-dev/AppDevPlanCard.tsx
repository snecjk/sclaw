/**
 * Plan 方案确认卡（T12）：可编辑需求 + 步骤清单，确认后开工。
 */
import { useEffect, useState } from 'react';
import { Check, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AppDevPlanDocument } from '@/lib/app-dev-plan-gate';

interface AppDevPlanCardProps {
  plan: AppDevPlanDocument;
  /** 是否启用 19s 倒计时自动确认。 */
  autoStartSeconds?: number;
  onConfirm: (plan: AppDevPlanDocument) => void;
  onDismiss?: () => void;
}

export function AppDevPlanCard({
  plan,
  autoStartSeconds = 19,
  onConfirm,
  onDismiss,
}: AppDevPlanCardProps) {
  const [summary, setSummary] = useState(plan.summary);
  const [stepsText, setStepsText] = useState(
    plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'),
  );
  const [secondsLeft, setSecondsLeft] = useState(autoStartSeconds);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setSummary(plan.summary);
    setStepsText(plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n'));
    setSecondsLeft(autoStartSeconds);
    setPaused(false);
  }, [plan, autoStartSeconds]);

  useEffect(() => {
    if (paused || autoStartSeconds <= 0) return;
    if (secondsLeft <= 0) {
      handleConfirm();
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟倒计时走
  }, [secondsLeft, paused, autoStartSeconds]);

  const handleConfirm = () => {
    const lines = stepsText
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.\u3001)]\s*/, '').trim())
      .filter(Boolean);
    const next: AppDevPlanDocument = {
      summary: summary.trim() || plan.summary,
      steps: (lines.length > 0 ? lines : plan.steps.map((s) => s.title)).map((title, i) => ({
        id: plan.steps[i]?.id ?? String(i + 1),
        title,
        fileHints: plan.steps[i]?.fileHints,
      })),
    };
    onConfirm(next);
  };

  return (
    <div
      className="mt-2 rounded-xl border border-border bg-card p-3 text-xs shadow-sm"
      data-testid="app-dev-plan-card"
      onPointerDown={() => setPaused(true)}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">实现方案（确认后开始写码）</span>
        <span className="flex-1" />
        {autoStartSeconds > 0 ? (
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
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        需求说明
      </label>
      <textarea
        className="mb-3 min-h-[72px] w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs leading-relaxed"
        value={summary}
        onChange={(e) => {
          setPaused(true);
          setSummary(e.target.value);
        }}
      />
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
        步骤清单
      </label>
      <textarea
        className="mb-3 min-h-[88px] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs leading-relaxed"
        value={stepsText}
        onChange={(e) => {
          setPaused(true);
          setStepsText(e.target.value);
        }}
      />
      <div className="flex items-center gap-2">
        {onDismiss ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onDismiss}>
            忽略方案
          </Button>
        ) : null}
        <span className="flex-1" />
        <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={handleConfirm}>
          <Check className="h-3.5 w-3.5" />
          确认执行
        </Button>
      </div>
    </div>
  );
}
