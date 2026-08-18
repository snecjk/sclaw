import type { BrowserAutomationPageObservation } from '../../../../shared/browser-automation/types';
import { browserAutomationRepository } from '../../../db/repositories/browser-automation-repository';
import { browserAutomationService } from '../../browser-automation/service';
import type { BrowserWorkflowPayload } from '../../../../shared/browser-automation/workflow-output';

export interface BrowserTaskResumeContext {
  isResume: boolean;
  baRunId: string;
  stepsCompleted: number;
  lastStep?: {
    action: string;
    status: string;
    error?: string;
  };
  lastObservation?: BrowserAutomationPageObservation;
}

function parseObservationJson(value: unknown): BrowserAutomationPageObservation | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const after = parsed.after;
    if (after && typeof after === 'object' && !Array.isArray(after)) {
      return after as BrowserAutomationPageObservation;
    }
    if (typeof parsed.url === 'string') {
      return parsed as unknown as BrowserAutomationPageObservation;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildResumeContextFromStepRuns(
  baRunId: string,
  stepRuns: Array<Record<string, unknown>>,
): BrowserTaskResumeContext {
  const lastStepRow = stepRuns.length > 0 ? stepRuns[stepRuns.length - 1] : undefined;
  let lastObservation: BrowserAutomationPageObservation | undefined;
  for (let index = stepRuns.length - 1; index >= 0; index -= 1) {
    lastObservation = parseObservationJson(stepRuns[index]?.observation_json);
    if (lastObservation) break;
  }

  return {
    isResume: stepRuns.length > 0,
    baRunId,
    stepsCompleted: stepRuns.length,
    lastStep: lastStepRow
      ? {
        action: String(lastStepRow.action ?? 'unknown'),
        status: String(lastStepRow.status ?? 'UNKNOWN'),
        error: typeof lastStepRow.error === 'string' ? lastStepRow.error : undefined,
      }
      : undefined,
    lastObservation,
  };
}

export async function resolveBaRunForBrowserTask(input: {
  workflowRunId: string;
  sessionId: string;
  sessionPayload: BrowserWorkflowPayload;
  forceNew?: boolean;
}): Promise<BrowserTaskResumeContext & { created: boolean }> {
  if (input.forceNew) {
    const baRunId = await browserAutomationService.startRun(input.sessionId, {
      workflowRunId: input.workflowRunId,
    });
    return {
      created: true,
      isResume: false,
      baRunId,
      stepsCompleted: 0,
    };
  }

  const candidates: string[] = [];
  if (input.sessionPayload.baRunId) candidates.push(input.sessionPayload.baRunId);

  const latest = await browserAutomationRepository.findLatestRunForWorkflow(
    input.workflowRunId,
    input.sessionId,
  );
  if (latest && typeof latest.run_id === 'string') {
    candidates.push(latest.run_id);
  }

  for (const runId of [...new Set(candidates)]) {
    const row = await browserAutomationRepository.getRun(runId);
    if (!row || row.status !== 'RUNNING' || row.session_id !== input.sessionId) continue;
    const stepRuns = await browserAutomationRepository.listStepRuns(runId);
    return {
      created: false,
      ...buildResumeContextFromStepRuns(runId, stepRuns),
    };
  }

  const baRunId = await browserAutomationService.startRun(input.sessionId, {
    workflowRunId: input.workflowRunId,
  });
  return {
    created: true,
    isResume: false,
    baRunId,
    stepsCompleted: 0,
  };
}
