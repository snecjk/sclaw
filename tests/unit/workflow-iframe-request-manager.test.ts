import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWorkflowIframeRequestManager } from '@/pages/Workflow/components/workflow-iframe-request-manager';
import type { WorkflowSavedDraftSnapshot } from '@/lib/workflow-iframe-bridge';

function savedSnapshot(versionId = 'ver_3'): WorkflowSavedDraftSnapshot {
  return {
    workflowId: 'wf_123',
    workflowVersionId: versionId,
    schemaVersion: 'workflow/v2',
    versionStatus: 'draft',
    startup: { schema: null, defaultValues: {} },
  };
}

describe('workflow iframe request manager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses the promise for the same in-flight request', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const first = manager.begin('req-1');
    const duplicate = manager.begin('req-1');

    expect(duplicate).toBe(first);
    expect(manager.resolve('req-1', savedSnapshot())).toBe(true);
    await expect(first).resolves.toEqual(savedSnapshot());
  });

  it('rejects a different concurrent request without replacing the pending request', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const first = manager.begin('req-1');

    await expect(manager.begin('req-2')).rejects.toThrow('正在保存当前画布草稿');
    expect(manager.resolve('req-1', savedSnapshot())).toBe(true);
    await expect(first).resolves.toEqual(savedSnapshot());
  });

  it('resolves only the matching request', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');

    expect(manager.resolve('req-other', savedSnapshot('ver_other'))).toBe(false);
    expect(manager.resolve('req-1', savedSnapshot())).toBe(true);
    await expect(pending).resolves.toEqual(savedSnapshot());
  });

  it('rejects a matching request with the supplied error', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');

    expect(manager.reject('req-1', new Error('保存失败'))).toBe(true);
    await expect(pending).rejects.toThrow('保存失败');
  });

  it('keeps a timeout tombstone, rejects the same id, ignores late response, and accepts a new id', async () => {
    vi.useFakeTimers();
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');
    const assertion = expect(pending).rejects.toThrow('未能保存当前画布草稿');

    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    const replay = manager.begin('req-1');
    expect(replay).toBe(pending);
    await expect(replay).rejects.toThrow('未能保存当前画布草稿');
    expect(manager.resolve('req-1', savedSnapshot())).toBe(false);

    const next = manager.begin('req-2');
    expect(manager.resolve('req-2', savedSnapshot('ver_4'))).toBe(true);
    await expect(next).resolves.toEqual(savedSnapshot('ver_4'));
  });

  it('does not reopen a resolved request id', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');

    expect(manager.resolve('req-1', savedSnapshot())).toBe(true);
    await expect(pending).resolves.toEqual(savedSnapshot());
    expect(manager.begin('req-1')).toBe(pending);
    expect(manager.resolve('req-1', savedSnapshot('ver_late'))).toBe(false);
  });

  it('does not reopen a rejected request id', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');
    const assertion = expect(pending).rejects.toThrow('保存失败');

    expect(manager.reject('req-1', new Error('保存失败'))).toBe(true);
    await assertion;
    expect(manager.begin('req-1')).toBe(pending);
    await expect(manager.begin('req-1')).rejects.toThrow('保存失败');
  });

  it('disposes the pending request and ignores future terminal messages', async () => {
    const manager = createWorkflowIframeRequestManager({ timeoutMs: 30_000 });
    const pending = manager.begin('req-1');

    manager.dispose();

    await expect(pending).rejects.toThrow('画布会话已重置，无法保存草稿');
    expect(manager.resolve('req-1', savedSnapshot())).toBe(false);
    expect(manager.reject('req-1', new Error('late error'))).toBe(false);
  });
});
