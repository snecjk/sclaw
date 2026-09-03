import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelRun,
  getRunViaIpc,
  getWorkflowDetail,
  runToExecutionState,
  startWorkflowLocal,
} from '@/lib/workflow-api';
import { useDesignerTryRun } from '@/pages/WorkflowDesigner/hooks/use-designer-try-run';
import {
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  type WorkflowDraftSnapshot,
} from '@/lib/workflow-iframe-bridge';
import { dispatchReadyWorkflowIframeIntent } from '@/pages/Workflow/components/workflow-iframe-session';
import { useAgentEnginePolicyStore } from '@/stores/agent-engine-policy';

let handoffListener: ((request: { runId: string; complete: () => void }) => boolean) | undefined;

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

vi.mock('@/lib/workflow-result-drawer-handoff', () => ({
  subscribeWorkflowResultDrawerHandoff: vi.fn((listener) => {
    handoffListener = listener;
    return () => {
      if (handoffListener === listener) handoffListener = undefined;
    };
  }),
}));

vi.mock('@/stores/workflow-memory', () => ({
  saveWorkflowExecution: vi.fn(),
  updateExecutionStatus: vi.fn(),
}));

describe('useDesignerTryRun snapshot status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentEnginePolicyStore.setState({
      engines: [
        { code: 'pi', name: 'PI', order: 10 },
        { code: 'openclaw', name: 'OpenClaw', order: 20 },
        { code: 'claude', name: 'Claude', order: 30 },
      ],
      defaultEngine: 'pi',
      loaded: true,
      ownerCode: '',
    });
  });

  it('starts with configured workflow inputs without opening startup confirmation', async () => {
    vi.mocked(getWorkflowDetail).mockResolvedValueOnce({
      workflowId: 'wf-1',
      workflowName: '参数工作流',
      version: 7,
      nodes: [],
      edges: [],
      startup: {
        schemaHash: 'schema-1',
        schema: {
          nodeId: 'startup-1',
          enabled: true,
          steps: [],
          fields: [
            { key: 'city', label: '城市', group: 'default', order: 1, component: 'text', defaultValue: '西安' },
            { key: 'days', label: '天数', group: 'default', order: 2, component: 'integer', defaultValue: 3 },
          ],
        },
        defaultPreset: {
          id: 'preset-1',
          name: '默认配置',
          workflowId: 'wf-1',
          workflowVersionId: 7,
          values: { city: '兰州', days: 7 },
          schemaHash: 'schema-1',
          isDefault: true,
          status: 'active',
        },
      },
    });
    vi.mocked(startWorkflowLocal).mockResolvedValueOnce({
      runId: 'run-parameterized',
      workflowId: 'wf-1',
      versionId: 7,
      workflowVersion: 7,
      startedAt: '2026-08-26T13:00:00+08:00',
    });
    const { result } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));

    act(() => result.current.begin());

    await waitFor(() => expect(startWorkflowLocal).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'wf-1',
      inputs: { city: '兰州', days: 7 },
      engineType: 'pi',
      runMode: 'trial',
    })));
    expect(result.current.isStartupDialogOpen).toBe(false);
    expect(result.current.isDrawerOpen).toBe(true);
  });

  it('keeps runtime file selection but merges configured startup inputs automatically', async () => {
    const snapshot: WorkflowDraftSnapshot = {
      workflowId: 'wf-1',
      workflowVersionId: 'draft-8',
      versionStatus: 'draft',
      definition: {
        nodes: [{
          id: 'fetch-1',
          type: 'agent_data_fetch',
          name: '上传数据',
          config: { businessConfig: { inputProvisionMode: 'runtime_upload' } },
        }],
        edges: [],
      },
      startup: {
        schema: {
          nodeId: 'startup-1',
          enabled: true,
          steps: [],
          fields: [{ key: 'city', label: '城市', group: 'default', order: 1, component: 'text' }],
        },
        defaultValues: { city: '兰州' },
      },
    };
    vi.mocked(startWorkflowLocal).mockResolvedValueOnce({
      runId: 'run-upload',
      workflowId: 'wf-1',
      versionId: 'draft-8',
      workflowVersion: 8,
      startedAt: '2026-08-26T13:00:00+08:00',
    });
    const { result } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));

    act(() => result.current.begin(snapshot));
    await waitFor(() => expect(result.current.isStartupDialogOpen).toBe(true));
    expect(startWorkflowLocal).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmStartup({
        __workflowRuntimeUploads: {
          'fetch-1': [{ filePath: 'D:/data/input.xlsx', name: 'input.xlsx' }],
        },
      }, 'openclaw');
    });

    expect(startWorkflowLocal).toHaveBeenCalledWith(expect.objectContaining({
      inputs: {
        city: '兰州',
        __workflowRuntimeUploads: {
          'fetch-1': [{ filePath: 'D:/data/input.xlsx', name: 'input.xlsx' }],
        },
      },
      engineType: 'openclaw',
    }));
  });

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

  it('closes a matching open trial drawer before completing result handoff', async () => {
    vi.mocked(getRunViaIpc).mockResolvedValue({
      id: 'run-1',
      workflowId: 'wf-1',
      workflowVersion: 7,
      status: 'completed',
      nodeRuns: [],
      events: [],
      artifacts: [],
      output: null,
      error: null,
    });
    const { result } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));
    await act(async () => {
      await result.current.openExistingRun('run-1');
    });
    expect(result.current.isDrawerOpen).toBe(true);
    const complete = vi.fn();

    await act(async () => {
      expect(handoffListener?.({ runId: 'run-1', complete })).toBe(true);
    });

    expect(result.current.isDrawerOpen).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not close the trial drawer for another run', async () => {
    vi.mocked(getRunViaIpc).mockResolvedValue({
      id: 'run-1',
      workflowId: 'wf-1',
      workflowVersion: 7,
      status: 'completed',
      nodeRuns: [],
      events: [],
      artifacts: [],
      output: null,
      error: null,
    });
    const { result } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));
    await act(async () => {
      await result.current.openExistingRun('run-1');
    });
    const complete = vi.fn();

    act(() => {
      expect(handoffListener?.({ runId: 'run-other', complete })).toBe(false);
    });

    expect(result.current.isDrawerOpen).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('completes a claimed handoff if the workflow page unmounts while closing', async () => {
    vi.mocked(getRunViaIpc).mockResolvedValue({
      id: 'run-1',
      workflowId: 'wf-1',
      workflowVersion: 7,
      status: 'completed',
      nodeRuns: [],
      events: [],
      artifacts: [],
      output: null,
      error: null,
    });
    const { result, unmount } = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));
    await act(async () => {
      await result.current.openExistingRun('run-1');
    });
    const complete = vi.fn();

    act(() => {
      expect(handoffListener?.({ runId: 'run-1', complete })).toBe(true);
      unmount();
    });

    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not cancel an active run when an authenticated Web back request unloads the controller', async () => {
    vi.mocked(getRunViaIpc).mockResolvedValue({
      id: 'run-active',
      workflowId: 'wf-1',
      workflowVersion: 7,
      status: 'running',
      nodeRuns: [],
      events: [],
      artifacts: [],
      output: null,
      error: null,
    });
    vi.mocked(runToExecutionState).mockReturnValue({
      runId: 'run-active',
      workflowId: 'wf-1',
      status: 'running',
      nodeStates: [],
      events: [],
      artifacts: [],
    });
    const controller = renderHook(() => useDesignerTryRun({
      workflowId: 'wf-1',
      startupSchema: null,
      canStart: () => true,
    }));
    await act(async () => {
      await controller.result.current.openExistingRun('run-active');
    });
    expect(controller.result.current.isRunActive).toBe(true);

    const source = window;
    const handled = dispatchReadyWorkflowIframeIntent({
      origin: 'https://mc.example.com',
      source,
      data: {
        protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
        type: 'workflow-back-request',
        workflowId: 'wf-1',
        nonce: 'nonce-1',
        requestId: 'back-1',
      },
    } as MessageEvent<unknown>, {
      expectedOrigin: 'https://mc.example.com',
      expectedSource: source,
      workflowId: 'wf-1',
      nonce: 'nonce-1',
    }, true, {
      onBackRequest: controller.unmount,
    });

    expect(handled).toBe(true);
    expect(cancelRun).not.toHaveBeenCalled();
  });
});
