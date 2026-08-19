import { describe, expect, it } from 'vitest';
import {
  buildResumeContextFromStepRuns,
} from '../../electron/services/workflow-runtime/browser-nodes/resume-context';

describe('browser task resume context', () => {
  it('builds resume context from completed step runs', () => {
    const context = buildResumeContextFromStepRuns('ba-run-1', [
      {
        action: 'click',
        status: 'SUCCEEDED',
        observation_json: JSON.stringify({
          after: { url: 'https://example.com/done', title: 'Done', elements: [] },
        }),
      },
    ]);

    expect(context).toMatchObject({
      isResume: true,
      baRunId: 'ba-run-1',
      stepsCompleted: 1,
      lastStep: { action: 'click', status: 'SUCCEEDED' },
      lastObservation: { url: 'https://example.com/done', title: 'Done' },
    });
  });

  it('returns fresh context when no steps exist', () => {
    expect(buildResumeContextFromStepRuns('ba-run-2', [])).toMatchObject({
      isResume: false,
      baRunId: 'ba-run-2',
      stepsCompleted: 0,
    });
  });
});
