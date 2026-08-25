import { describe, expect, it } from 'vitest';

import { mapWorkflowRunStatusToTryRunState } from '@/pages/Workflow/hooks/workflow-try-run-display-state';

describe('mapWorkflowRunStatusToTryRunState', () => {
  it.each([
    ['pending', 'running'],
    ['running', 'running'],
    ['waiting_approval', 'running'],
    ['waiting_input', 'running'],
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['timeout', 'failed'],
    ['interrupted', 'failed'],
    ['completed', 'completed'],
    ['unknown', null],
    [undefined, null],
    [null, null],
  ] as const)('maps %s to %s', (status, expected) => {
    expect(mapWorkflowRunStatusToTryRunState(status)).toBe(expected);
  });
});
