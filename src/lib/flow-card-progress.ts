import { useEffect, useState } from 'react';

/** Progress-step helpers for flow_card validating UI (design-aligned, result-gated). */

export type FlowCardProgressStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface FlowCardProgressStep {
  id: string;
  title: string;
  detail?: string;
}

export type FlowCardValidationOutcome = 'pass' | 'fail';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseFlowCardProgressSteps(data: Record<string, unknown> | undefined): FlowCardProgressStep[] {
  if (!data) return [];
  const raw = data.progressSteps;
  if (!Array.isArray(raw)) return [];
  const steps: FlowCardProgressStep[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;
    const id = typeof item.id === 'string' && item.id.trim()
      ? item.id.trim()
      : `step-${steps.length + 1}`;
    const detail = typeof item.detail === 'string' ? item.detail : undefined;
    steps.push({ id, title, detail });
  }
  return steps;
}

export function parseFlowCardValidationOutcome(
  data: Record<string, unknown> | undefined,
): FlowCardValidationOutcome | null {
  if (!data) return null;
  const value = data.validationOutcome;
  if (value === 'pass' || value === 'fail') return value;
  return null;
}

/**
 * Visual statuses for gated simulation:
 * - Before outcome: only step 0 is active (hold — wait for real校验).
 * - After outcome: all steps done; last step is error when fail.
 */
export function resolveGatedProgressStatuses(
  stepCount: number,
  outcome: FlowCardValidationOutcome | null,
  finishingIndex: number | null,
): FlowCardProgressStepStatus[] {
  if (stepCount <= 0) return [];

  if (outcome == null && finishingIndex == null) {
    return Array.from({ length: stepCount }, (_, i) => (i === 0 ? 'active' : 'pending'));
  }

  // Mid finishing animation: steps < finishingIndex done, finishingIndex active, rest pending
  if (outcome != null && finishingIndex != null && finishingIndex < stepCount) {
    return Array.from({ length: stepCount }, (_, i) => {
      if (i < finishingIndex) return 'done';
      if (i === finishingIndex) return outcome === 'fail' && i === stepCount - 1 ? 'error' : 'active';
      return 'pending';
    });
  }

  // Finished
  return Array.from({ length: stepCount }, (_, i) => {
    if (outcome === 'fail' && i === stepCount - 1) return 'error';
    return 'done';
  });
}

/** Gated progress animation — body/actions should wait until this returns true. */
export function useFlowCardProgressAnimation(card: {
  cardId: string;
  data?: Record<string, unknown>;
}) {
  const steps = parseFlowCardProgressSteps(card.data);
  const outcome = parseFlowCardValidationOutcome(card.data);
  const [finishingIndex, setFinishingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!outcome || steps.length === 0) {
      setFinishingIndex(null);
      return;
    }
    setFinishingIndex(0);
    const timers: number[] = [];
    for (let i = 1; i <= steps.length; i += 1) {
      timers.push(
        window.setTimeout(() => {
          setFinishingIndex(i >= steps.length ? null : i);
        }, i * 280),
      );
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [outcome, steps.length, card.cardId]);

  const statuses = resolveGatedProgressStatuses(steps.length, outcome, finishingIndex);
  const allDone = steps.length === 0 || (outcome != null && finishingIndex == null);
  const progressSettled = steps.length === 0 || allDone;

  return { steps, outcome, finishingIndex, statuses, allDone, progressSettled };
}
