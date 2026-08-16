import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDesignerTryRun } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';
import type { WorkflowDraftSnapshot } from '@/lib/workflow-iframe-bridge';

vi.mock('@/lib/workflow-api', () => ({
  cancelRun: vi.fn(),
  getRunViaIpc: vi.fn(),
  resumeWorkflowRun: vi.fn(),
  resumeWorkflowApproval: vi.fn(),
  runToExecutionState: vi.fn(),
  startWorkflowLocal: vi.fn(),
  getWorkflowDetail: vi.fn().mockResolvedValue({
    workflowId: 'wf-1',
    workflowName: '已发布流程',
    version: 7,
    nodes: [],
    edges: [],
    startup: { schema: null, defaultPreset: null },
  }),
  submitWorkflowInput: vi.fn(),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: vi.fn(() => () => undefined),
}));

vi.mock('@/stores/workflow-memory', () => ({
  saveWorkflowExecution: vi.fn(),
  updateExecutionStatus: vi.fn(),
}));

describe('useDesignerTryRun snapshot status', () => {
  it('does not label an explicit published-version trial run as a draft snapshot', async () => {
    const publishedSnapshot: WorkflowDraftSnapshot = {
      workflowId: 'wf-1',
      workflowVersionId: 'published-7',
      schemaVersion: 'workflow/v2',
      versionStatus: 'published',
      definition: { nodes: [], edges: [] },
      startup: { schema: null, defaultValues: {} },
    };
    const { result } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));

    await act(async () => {
      result.current.begin(publishedSnapshot);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isDraftSnapshot).toBe(false);
  });
});
