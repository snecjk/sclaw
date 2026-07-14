import { describe, it, expect, vi } from 'vitest';
import { flushOnce } from '../../electron/services/workflow-runtime/outbox-flusher';

const mkEntry = (id: number, run_id: string, entity_type = 'node_run', payload: any = {}) => ({
  id, run_id, entity_type, entity_ref: `${run_id}:n${id}`, payload: JSON.stringify(payload),
  sync_kind: 'progress', status: 'pending', attempts: 0,
});

describe('outbox-flusher', () => {
  it('marks synced on 200', async () => {
    const repo: any = {
      listPendingOutbox: vi.fn().mockResolvedValue([mkEntry(1, 'r1', 'node_run', { status: 'RUNNING' })]),
      markOutboxSynced: vi.fn().mockResolvedValue(undefined),
      bumpOutboxAttempts: vi.fn(),
    };
    const postSync = vi.fn().mockResolvedValue({ result: { applied: 1 } });
    await flushOnce({ repo, postSync });
    expect(repo.markOutboxSynced).toHaveBeenCalledWith([1]);
    expect(postSync).toHaveBeenCalled();
  });
  it('bumps attempts + backoff on failure', async () => {
    const repo: any = {
      listPendingOutbox: vi.fn().mockResolvedValue([mkEntry(2, 'r1', 'run', { status: 'RUNNING' })]),
      markOutboxSynced: vi.fn(),
      bumpOutboxAttempts: vi.fn().mockResolvedValue(undefined),
    };
    const postSync = vi.fn().mockRejectedValue(new Error('500'));
    await flushOnce({ repo, postSync });
    expect(repo.bumpOutboxAttempts).toHaveBeenCalledWith([2], expect.any(String));
    expect(repo.markOutboxSynced).not.toHaveBeenCalled();
  });
  it('signals token-expired on 401 and stops (no markSynced)', async () => {
    const onTokenExpired = vi.fn();
    const repo: any = {
      listPendingOutbox: vi.fn().mockResolvedValue([mkEntry(3, 'r1', 'run', { status: 'RUNNING' })]),
      markOutboxSynced: vi.fn(),
      bumpOutboxAttempts: vi.fn(),
    };
    const postSync = vi.fn().mockRejectedValue({ status: 401 });
    await flushOnce({ repo, postSync, onTokenExpired });
    expect(onTokenExpired).toHaveBeenCalled();
    expect(repo.bumpOutboxAttempts).not.toHaveBeenCalled();
    expect(repo.markOutboxSynced).not.toHaveBeenCalled();
  });
  it('groups by run and pushes per-run batches (FIFO by id asc)', async () => {
    const repo: any = {
      listPendingOutbox: vi.fn().mockResolvedValue([
        mkEntry(1, 'r1'), mkEntry(2, 'r2'), mkEntry(3, 'r1'),
      ]),
      markOutboxSynced: vi.fn().mockResolvedValue(undefined),
      bumpOutboxAttempts: vi.fn(),
    };
    const calls: any[] = [];
    const postSync = vi.fn().mockImplementation(async (runId: string, entries: any[]) => { calls.push({ runId, ids: entries.map((e: any) => e.entity_ref) }); });
    await flushOnce({ repo, postSync });
    expect(calls.map((c) => c.runId).sort()).toEqual(['r1', 'r2']);
    const r1Call = calls.find((c) => c.runId === 'r1');
    expect(r1Call!.ids).toHaveLength(2); // r1 的两条合并一批
  });
});
