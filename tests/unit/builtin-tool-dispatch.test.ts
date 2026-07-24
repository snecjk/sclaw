import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchBuiltinToolResult,
  resetBuiltinToolDispatchDedupe,
} from '@/lib/builtin-tool-dispatch';

const applyWorkflowSchemaReady = vi.fn();
const ensureWorkflowParameterFormInjected = vi.fn(() => false);
const saveWorkflowExecution = vi.fn();
const updateExecutionStatus = vi.fn();
const setWorkflowCardState = vi.fn();

vi.mock('@/stores/chat/parameter-form-recovery', () => ({
  applyWorkflowSchemaReady: (...args: unknown[]) => applyWorkflowSchemaReady(...args),
  ensureWorkflowParameterFormInjected: () => ensureWorkflowParameterFormInjected(),
}));

vi.mock('@/stores/workflow-memory', () => ({
  saveWorkflowRecord: vi.fn(),
  saveWorkflowExecution: (...args: unknown[]) => saveWorkflowExecution(...args),
  updateExecutionStatus: (...args: unknown[]) => updateExecutionStatus(...args),
  getExecutionByRunId: vi.fn(() => undefined),
  listSessionExecutions: vi.fn(() => []),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      messages: [],
      workflowCardStates: {},
      setWorkflowCardState,
    }),
    setState: vi.fn(),
  },
}));

vi.mock('@/lib/workflow-run-started', () => ({
  applyWorkflowRunStarted: vi.fn(async () => true),
}));

import { applyWorkflowRunStarted } from '@/lib/workflow-run-started';

describe('dispatchBuiltinToolResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBuiltinToolDispatchDedupe();
  });

  it('handles workflow_schema_ready envelope', async () => {
    const handled = await dispatchBuiltinToolResult({
      id: 'tool-1',
      content: JSON.stringify({
        type: 'workflow_schema_ready',
        success: true,
        domain: 'workflow',
        data: {
          templateId: 'tpl-1',
          schemaHash: 'h1',
          schema: { fields: [], steps: [], nodeId: '', enabled: true },
        },
      }),
    });
    expect(handled).toBe(true);
    expect(applyWorkflowSchemaReady).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl-1' }),
    );
  });

  it('passes explicit sessionKey for workflow_execution_started', async () => {
    const handled = await dispatchBuiltinToolResult({
      id: 'tool-wf-1',
      content: JSON.stringify({
        type: 'workflow_execution_started',
        success: true,
        domain: 'workflow',
        data: {
          workflowId: 'wf_1',
          runId: 'run_1',
          templateName: '测试',
        },
      }),
    }, {
      sessionKey: 'agent:main:cron:job-1:2026-07-01',
      agentId: 'main',
    });
    expect(handled).toBe(true);
    expect(applyWorkflowRunStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'agent:main:cron:job-1:2026-07-01',
        agentId: 'main',
        runId: 'run_1',
        workflowId: 'wf_1',
      }),
    );
  });

  it('dedupes by tool result id', async () => {
    const msg = {
      id: 'tool-dup',
      content: JSON.stringify({
        type: 'workflow_schema_ready',
        success: true,
        domain: 'workflow',
        data: {
          templateId: 'tpl-1',
          schemaHash: 'h1',
          schema: { fields: [], steps: [], nodeId: '', enabled: true },
        },
      }),
    };
    expect(await dispatchBuiltinToolResult(msg)).toBe(true);
    expect(await dispatchBuiltinToolResult(msg)).toBe(false);
    expect(applyWorkflowSchemaReady).toHaveBeenCalledTimes(1);
  });

  it('turns a workflow_run_status result into a tracked card state', async () => {
    const handled = await dispatchBuiltinToolResult({
      id: 'tool-status-1',
      content: JSON.stringify({
        type: 'workflow_run_status',
        success: true,
        domain: 'workflow',
        data: {
          id: 'run_status_1',
          workflowId: 'wf_status_1',
          status: 'running',
          startedAt: '2026-07-24T10:00:00.000Z',
          nodeRuns: [
            { id: 'node-1', nodeId: 'fetch', status: 'completed' },
            { id: 'node-2', nodeId: 'report', status: 'running' },
          ],
        },
      }),
    });

    expect(handled).toBe(true);
    expect(saveWorkflowExecution).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run_status_1',
      workflowId: 'wf_status_1',
      status: 'running',
    }));
    expect(setWorkflowCardState).toHaveBeenCalledWith(
      'run_status_1',
      expect.objectContaining({
        status: 'running',
        progress: 50,
        currentStep: 'report',
      }),
    );
  });
});
