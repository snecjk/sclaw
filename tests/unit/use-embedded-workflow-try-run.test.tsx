import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeWorkflowSavedDraftSnapshot,
  useEmbeddedWorkflowTryRun,
} from '@/pages/Workflow/hooks/use-embedded-workflow-try-run';
import type { WorkflowMcIframeEditorHandle } from '@/pages/Workflow/components/workflow-mc-iframe-editor';
import type { WorkflowSavedDraftSnapshot } from '@/lib/workflow-iframe-bridge';

const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

function savedSnapshot(
  schema: WorkflowSavedDraftSnapshot['startup']['schema'] = null,
): WorkflowSavedDraftSnapshot {
  return {
    workflowId: 'wf-1',
    workflowVersionId: 'draft-3',
    schemaVersion: 'workflow/v2',
    versionStatus: 'draft',
    startup: { schema, defaultValues: { topic: '月报' } },
  };
}

function createEditor(snapshot = savedSnapshot()) {
  return {
    requestPersistedDraftSnapshot: vi.fn().mockResolvedValue(snapshot),
    requestLegacyDraftSnapshot: vi.fn().mockResolvedValue({
      workflowId: 'wf-1',
      workflowVersionId: 'legacy-2',
      schemaVersion: 'workflow/v2',
      versionStatus: 'draft',
      startup: { schema: null, defaultValues: {} },
    }),
    sendTryRunState: vi.fn(),
    requestDraftSnapshot: vi.fn(),
  } satisfies WorkflowMcIframeEditorHandle;
}

function setup(overrides: Partial<Parameters<typeof useEmbeddedWorkflowTryRun>[0]> = {}) {
  const editor = createEditor();
  const editorRef = { current: editor };
  const beginTryRun = vi.fn();
  const base = {
    workflowId: 'wf-1',
    editorSessionIdentity: 'session-1',
    editorRef,
    editorCapabilitiesReady: true,
    beginTryRun,
    isRunActive: false,
    isRunStarting: false,
    runId: null,
    runStatus: null,
    launchError: null,
    createRequestId: vi.fn().mockReturnValue('host-1'),
    ...overrides,
  };
  const rendered = renderHook(
    (props: typeof base) => useEmbeddedWorkflowTryRun(props),
    { initialProps: base },
  );
  return { ...rendered, editor, editorRef, beginTryRun, base };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('normalizeWorkflowSavedDraftSnapshot', () => {
  it.each([undefined, null])('normalizes a %s node id and fills optional runtime fields', (nodeId) => {
    const wireSchema = {
      ...(nodeId !== undefined ? { nodeId } : {}),
      enabled: true,
      steps: [{ id: 'step-1', title: '填写参数' }],
      fields: [{
        key: 'topic',
        label: '主题',
        group: 'basic',
        defaultValue: '周报',
        options: [{ value: 'weekly', label: '周报', description: '每周', tags: ['report'] }],
        items: [{ fieldKey: 'detail', label: '详情', defaultValue: '完整' }],
      }],
    } satisfies NonNullable<WorkflowSavedDraftSnapshot['startup']['schema']>;

    expect(normalizeWorkflowSavedDraftSnapshot(savedSnapshot(wireSchema))).toEqual({
      workflowId: 'wf-1',
      workflowVersionId: 'draft-3',
      schemaVersion: 'workflow/v2',
      versionStatus: 'draft',
      startup: {
        schema: {
          nodeId: '',
          enabled: true,
          steps: [{ id: 'step-1', title: '填写参数', mode: 'confirm', order: 1 }],
          fields: [{
            key: 'topic',
            label: '主题',
            group: 'basic',
            order: 1,
            component: 'text',
            defaultValue: '周报',
            options: [{ value: 'weekly', label: '周报', description: '每周', tags: ['report'] }],
            items: [{ fieldKey: 'detail', label: '详情', defaultValue: '完整' }],
          }],
        },
        defaultValues: { topic: '月报' },
      },
    });
  });

  it('preserves explicit step and field runtime values', () => {
    const normalized = normalizeWorkflowSavedDraftSnapshot(savedSnapshot({
      nodeId: 'trigger-1',
      enabled: true,
      steps: [{ id: 'step-1', title: '自动', mode: 'auto', order: 8 }],
      fields: [{ key: 'count', label: '数量', group: 'basic', order: 9, component: 'number' }],
    }));

    expect(normalized.startup.schema).toEqual(expect.objectContaining({
      nodeId: 'trigger-1',
      steps: [expect.objectContaining({ mode: 'auto', order: 8 })],
      fields: [expect.objectContaining({ order: 9, component: 'number' })],
    }));
  });
});

describe('useEmbeddedWorkflowTryRun', () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it('runs an unchanged published snapshot without confirmation or draft persistence', async () => {
    const { result, editor, beginTryRun } = setup();
    const publishedSnapshot = {
      workflowId: 'wf-1',
      workflowVersionId: 'published-7',
      schemaVersion: 'workflow/v2' as const,
      versionStatus: 'published' as const,
      startup: { schema: null, defaultValues: { topic: '月报' } },
    };

    act(() => result.current.requestFromWeb('req-published', {
      mode: 'use-current-published',
      snapshot: publishedSnapshot,
    }));

    await waitFor(() => expect(beginTryRun).toHaveBeenCalledOnce());
    expect(result.current.confirmOpen).toBe(false);
    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).toHaveBeenCalledWith(publishedSnapshot);
    expect(editor.sendTryRunState.mock.calls).toEqual([
      ['req-published', 'preparing'],
    ]);
  });

  it('runs an unchanged draft snapshot without confirmation or draft persistence', async () => {
    const { result, editor, beginTryRun } = setup();
    const draftSnapshot = savedSnapshot();

    act(() => result.current.requestFromWeb('req-draft', {
      mode: 'use-current-draft',
      snapshot: draftSnapshot,
    }));

    await waitFor(() => expect(beginTryRun).toHaveBeenCalledOnce());
    expect(result.current.confirmOpen).toBe(false);
    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).toHaveBeenCalledWith(draftSnapshot);
    expect(editor.sendTryRunState.mock.calls).toEqual([
      ['req-draft', 'preparing'],
    ]);
  });

  it('saves and normalizes before beginning the negotiated local trial run', async () => {
    const order: string[] = [];
    const editor = createEditor();
    editor.requestPersistedDraftSnapshot.mockImplementation(async () => {
      order.push('save');
      return savedSnapshot();
    });
    const beginTryRun = vi.fn(() => order.push('begin'));
    const { result } = setup({ editorRef: { current: editor }, beginTryRun });

    act(() => result.current.requestFromWeb('req-1'));
    await act(() => result.current.confirmAndPrepare());

    expect(order).toEqual(['save', 'begin']);
    expect(editor.requestPersistedDraftSnapshot).toHaveBeenCalledWith('req-1');
    expect(editor.requestLegacyDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).toHaveBeenCalledWith(normalizeWorkflowSavedDraftSnapshot(savedSnapshot()));
    expect(editor.sendTryRunState.mock.calls).toEqual([
      ['req-1', 'confirming'],
      ['req-1', 'saving'],
      ['req-1', 'preparing'],
    ]);
  });

  it('does not save when confirmation is cancelled', () => {
    const { result, editor } = setup();

    act(() => result.current.requestFromWeb('req-1'));
    act(() => result.current.cancelConfirmation());

    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(editor.sendTryRunState).toHaveBeenLastCalledWith('req-1', 'idle');
    expect(result.current.confirmOpen).toBe(false);
  });

  it('rejects an empty Web request id with error then idle', () => {
    const { result, editor, beginTryRun } = setup();

    act(() => result.current.requestFromWeb('   '));

    expect(result.current.confirmOpen).toBe(false);
    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).not.toHaveBeenCalled();
    expect(editor.sendTryRunState.mock.calls).toEqual([
      ['', 'error', '试运行请求标识无效，请重新发起'],
      ['', 'idle'],
    ]);
  });

  it('reports one save error, returns Web to idle, and never falls back or begins', async () => {
    const editor = createEditor();
    editor.requestPersistedDraftSnapshot.mockRejectedValue(new Error('保存失败'));
    const { result, beginTryRun } = setup({ editorRef: { current: editor } });

    act(() => result.current.requestFromWeb('req-1'));
    await act(() => result.current.confirmAndPrepare());

    expect(beginTryRun).not.toHaveBeenCalled();
    expect(editor.requestLegacyDraftSnapshot).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledOnce();
    expect(editor.sendTryRunState.mock.calls.slice(-2)).toEqual([
      ['req-1', 'error', '保存失败'],
      ['req-1', 'idle'],
    ]);
  });

  it('does not begin without an editor handle', async () => {
    const { result, beginTryRun } = setup({ editorRef: { current: null } });

    act(() => result.current.requestFromWeb('req-1'));
    await act(() => result.current.confirmAndPrepare());

    expect(beginTryRun).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledOnce();
  });

  it('deduplicates the same Web request and blocks a request while a run is active', async () => {
    const first = setup();
    act(() => {
      first.result.current.requestFromWeb('req-1');
      first.result.current.requestFromWeb('req-1');
    });
    await act(() => first.result.current.confirmAndPrepare());
    expect(first.editor.requestPersistedDraftSnapshot).toHaveBeenCalledOnce();
    expect(first.beginTryRun).toHaveBeenCalledOnce();

    const active = setup({ isRunActive: true });
    act(() => active.result.current.requestFromWeb('req-active'));
    expect(active.result.current.confirmOpen).toBe(false);
    expect(active.editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(active.beginTryRun).not.toHaveBeenCalled();
  });

  it('uses legacy snapshot only for the pre-capability Host fallback', async () => {
    const editor = createEditor();
    const { result, beginTryRun } = setup({
      editorRef: { current: editor },
      editorCapabilitiesReady: false,
    });

    act(() => result.current.requestFromHostFallback());
    await act(() => result.current.confirmAndPrepare());

    expect(editor.requestLegacyDraftSnapshot).toHaveBeenCalledOnce();
    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).toHaveBeenCalledWith(await editor.requestLegacyDraftSnapshot.mock.results[0].value);
  });

  it('reruns with a new request id and saves the current draft again', async () => {
    const editor = createEditor();
    const createRequestId = vi.fn()
      .mockReturnValueOnce('rerun-1')
      .mockReturnValueOnce('rerun-2');
    const { result, beginTryRun } = setup({ editorRef: { current: editor }, createRequestId });

    await act(() => result.current.rerun());
    act(() => result.current.cancelConfirmation());
    await act(() => result.current.rerun());

    expect(editor.requestPersistedDraftSnapshot.mock.calls).toEqual([['rerun-1'], ['rerun-2']]);
    expect(beginTryRun).toHaveBeenCalledTimes(2);
  });

  it('keeps the saved draft but returns to idle when startup is cancelled', async () => {
    const { result, editor, beginTryRun } = setup();
    act(() => result.current.requestFromWeb('req-1'));
    await act(() => result.current.confirmAndPrepare());

    act(() => result.current.cancelConfirmation());

    expect(beginTryRun).toHaveBeenCalledOnce();
    expect(editor.requestPersistedDraftSnapshot).toHaveBeenCalledOnce();
    expect(editor.sendTryRunState).toHaveBeenLastCalledWith('req-1', 'idle');
  });

  it('synchronizes running and retains the completed terminal state', async () => {
    const run = setup();
    act(() => run.result.current.requestFromWeb('req-1'));
    await act(() => run.result.current.confirmAndPrepare());

    run.rerender({ ...run.base, isRunStarting: true });
    await waitFor(() => expect(run.editor.sendTryRunState).toHaveBeenLastCalledWith('req-1', 'running'));
    run.rerender({
      ...run.base,
      isRunStarting: false,
      isRunActive: true,
      runId: 'run-1',
      runStatus: 'running',
    });
    run.rerender({
      ...run.base,
      isRunStarting: false,
      isRunActive: false,
      runId: 'run-1',
      runStatus: 'completed',
    });
    await waitFor(() => expect(run.editor.sendTryRunState).toHaveBeenLastCalledWith('req-1', 'completed'));
    expect(run.editor.sendTryRunState).not.toHaveBeenCalledWith('req-1', 'idle');
  });

  it.each([
    ['cancelled', 'cancelled'],
    ['failed', 'failed'],
    ['timeout', 'failed'],
  ] as const)('maps local terminal %s to retained bridge state %s', async (runStatus, expected) => {
    const run = setup();
    act(() => run.result.current.requestFromWeb('req-terminal'));
    await act(() => run.result.current.confirmAndPrepare());
    run.rerender({ ...run.base, isRunStarting: true });
    run.rerender({
      ...run.base,
      isRunStarting: false,
      isRunActive: true,
      runId: 'run-terminal',
      runStatus: 'running',
    });
    run.rerender({
      ...run.base,
      isRunStarting: false,
      isRunActive: false,
      runId: 'run-terminal',
      runStatus,
    });

    await waitFor(() => expect(run.editor.sendTryRunState).toHaveBeenLastCalledWith('req-terminal', expected));
  });

  it('does not attach a new request to the previous terminal run', async () => {
    const run = setup({ runId: 'run-old', runStatus: 'cancelled' });

    await act(() => run.result.current.rerun());
    run.rerender({ ...run.base, runId: 'run-old', runStatus: 'cancelled' });

    expect(run.editor.sendTryRunState).not.toHaveBeenCalledWith('host-1', 'cancelled');
  });

  it('reports a launch error only once and returns startup state to idle', async () => {

    const failed = setup();
    act(() => failed.result.current.requestFromWeb('req-error'));
    await act(() => failed.result.current.confirmAndPrepare());
    failed.rerender({ ...failed.base, isRunStarting: true });
    await waitFor(() => expect(failed.editor.sendTryRunState).toHaveBeenLastCalledWith('req-error', 'running'));
    failed.rerender({ ...failed.base, isRunStarting: false, launchError: '启动失败' });
    failed.rerender({ ...failed.base, launchError: '启动失败' });
    await waitFor(() => expect(toastError).toHaveBeenCalledOnce());
    expect(failed.editor.sendTryRunState.mock.calls.slice(-2)).toEqual([
      ['req-error', 'error', '启动失败'],
      ['req-error', 'idle'],
    ]);
  });

  it('silently invalidates a deferred save when workflow or iframe session changes', async () => {
    const save = deferred<WorkflowSavedDraftSnapshot>();
    const oldEditor = createEditor();
    oldEditor.requestPersistedDraftSnapshot.mockReturnValue(save.promise);
    const newEditor = createEditor();
    const editorRef = { current: oldEditor as WorkflowMcIframeEditorHandle | null };
    const { result, rerender, beginTryRun, base } = setup({ editorRef });

    act(() => result.current.requestFromWeb('req-old'));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirmAndPrepare();
    });
    editorRef.current = newEditor;
    rerender({
      ...base,
      workflowId: 'wf-2',
      editorSessionIdentity: 'session-2',
      editorRef,
    });
    await act(async () => {
      save.resolve(savedSnapshot());
      await pending;
    });

    expect(beginTryRun).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.confirmOpen).toBe(false);
    expect(result.current.requestInFlight).toBe(false);
    expect(newEditor.sendTryRunState).not.toHaveBeenCalled();
    expect(oldEditor.sendTryRunState).not.toHaveBeenCalledWith('req-old', 'preparing');
  });

  it('silently ignores a deferred rejection after unmount', async () => {
    const save = deferred<WorkflowSavedDraftSnapshot>();
    const editor = createEditor();
    editor.requestPersistedDraftSnapshot.mockReturnValue(save.promise);
    const { result, unmount, beginTryRun } = setup({ editorRef: { current: editor } });

    act(() => result.current.requestFromWeb('req-old'));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirmAndPrepare();
    });
    const callsBeforeUnmount = editor.sendTryRunState.mock.calls.length;
    unmount();
    await act(async () => {
      save.reject(new Error('late failure'));
      await pending;
    });

    expect(beginTryRun).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(editor.sendTryRunState).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it('closes a confirming attempt without messaging the replacement iframe session', () => {
    const oldEditor = createEditor();
    const newEditor = createEditor();
    const editorRef = { current: oldEditor as WorkflowMcIframeEditorHandle | null };
    const { result, rerender, base } = setup({ editorRef });

    act(() => result.current.requestFromWeb('req-old'));
    expect(result.current.confirmOpen).toBe(true);
    editorRef.current = newEditor;
    rerender({ ...base, editorSessionIdentity: 'session-2', editorRef });

    expect(result.current.confirmOpen).toBe(false);
    expect(newEditor.sendTryRunState).not.toHaveBeenCalled();
  });

  it('keeps the attempt on its captured editor when the imperative handle churns in the same session', async () => {
    const capturedEditor = createEditor();
    const replacementHandle = createEditor();
    const editorRef = { current: capturedEditor as WorkflowMcIframeEditorHandle | null };
    const { result, beginTryRun } = setup({ editorRef });

    act(() => result.current.requestFromWeb('req-handle-churn'));
    editorRef.current = replacementHandle;
    await act(() => result.current.confirmAndPrepare());

    expect(capturedEditor.requestPersistedDraftSnapshot).toHaveBeenCalledWith('req-handle-churn');
    expect(beginTryRun).toHaveBeenCalledWith(normalizeWorkflowSavedDraftSnapshot(savedSnapshot()));
    expect(capturedEditor.sendTryRunState).toHaveBeenLastCalledWith('req-handle-churn', 'preparing');
    expect(replacementHandle.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(replacementHandle.sendTryRunState).not.toHaveBeenCalled();
  });

  it('invalidates synchronously before a same-tick save rejection and accepts a new request', async () => {
    const oldSave = deferred<WorkflowSavedDraftSnapshot>();
    const editor = createEditor();
    editor.requestPersistedDraftSnapshot
      .mockReturnValueOnce(oldSave.promise)
      .mockResolvedValueOnce(savedSnapshot());
    const { result, beginTryRun } = setup({ editorRef: { current: editor } });

    act(() => result.current.requestFromWeb('req-before-reload'));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.confirmAndPrepare();
    });
    const callsBeforeReset = editor.sendTryRunState.mock.calls.length;
    act(() => result.current.invalidateSession());
    await act(async () => {
      oldSave.reject(new Error('disposed manager'));
      await pending;
    });

    expect(beginTryRun).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(editor.sendTryRunState).toHaveBeenCalledTimes(callsBeforeReset);

    act(() => result.current.requestFromWeb('req-after-reload'));
    await act(() => result.current.confirmAndPrepare());
    expect(editor.requestPersistedDraftSnapshot).toHaveBeenLastCalledWith('req-after-reload');
    expect(beginTryRun).toHaveBeenCalledOnce();
  });

  it('keeps a Web request id terminal after confirmation cancellation', () => {
    const { result, editor, beginTryRun } = setup();

    act(() => result.current.requestFromWeb('req-cancelled'));
    act(() => result.current.cancelConfirmation());
    const stateCalls = editor.sendTryRunState.mock.calls.length;
    act(() => result.current.requestFromWeb('req-cancelled'));

    expect(result.current.confirmOpen).toBe(false);
    expect(editor.sendTryRunState).toHaveBeenCalledTimes(stateCalls);
    expect(editor.requestPersistedDraftSnapshot).not.toHaveBeenCalled();
    expect(beginTryRun).not.toHaveBeenCalled();
  });

  it('does not begin again when a successful terminal Web request id is replayed', async () => {
    const run = setup();
    act(() => run.result.current.requestFromWeb('req-settled'));
    await act(() => run.result.current.confirmAndPrepare());
    run.rerender({ ...run.base, isRunStarting: true });
    run.rerender({ ...run.base, isRunStarting: false, isRunActive: false });
    const stateCalls = run.editor.sendTryRunState.mock.calls.length;

    act(() => run.result.current.requestFromWeb('req-settled'));

    expect(run.result.current.confirmOpen).toBe(false);
    expect(run.editor.requestPersistedDraftSnapshot).toHaveBeenCalledOnce();
    expect(run.beginTryRun).toHaveBeenCalledOnce();
    expect(run.editor.sendTryRunState).toHaveBeenCalledTimes(stateCalls);
  });

  it('keeps a failed Web request id terminal without duplicate toast or state', async () => {
    const editor = createEditor();
    editor.requestPersistedDraftSnapshot.mockRejectedValue(new Error('保存失败'));
    const failed = setup({ editorRef: { current: editor } });
    act(() => failed.result.current.requestFromWeb('req-failed'));
    await act(() => failed.result.current.confirmAndPrepare());
    const stateCalls = editor.sendTryRunState.mock.calls.length;

    act(() => failed.result.current.requestFromWeb('req-failed'));

    expect(failed.result.current.confirmOpen).toBe(false);
    expect(editor.requestPersistedDraftSnapshot).toHaveBeenCalledOnce();
    expect(editor.sendTryRunState).toHaveBeenCalledTimes(stateCalls);
    expect(toastError).toHaveBeenCalledOnce();
    expect(failed.beginTryRun).not.toHaveBeenCalled();
  });

  it('allows the same Web request id again after synchronous session invalidation', () => {
    const { result, editor } = setup();
    act(() => result.current.requestFromWeb('req-next-session'));
    act(() => result.current.cancelConfirmation());

    act(() => result.current.invalidateSession());
    act(() => result.current.requestFromWeb('req-next-session'));

    expect(result.current.confirmOpen).toBe(true);
    expect(editor.sendTryRunState).toHaveBeenLastCalledWith('req-next-session', 'confirming');
  });
});
