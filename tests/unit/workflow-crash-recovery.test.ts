import { describe, it, expect, vi } from 'vitest';
import { recoverOnLaunch, resumeRun } from '../../electron/services/workflow-runtime/crash-recovery';

describe('crash-recovery', () => {
  it('marks stuck runs INTERRUPTED + enqueues terminal outbox + calls onRecover', async () => {
    const stuck = [{ run_id: 'r1', workflow_id: 'w1', version_id: 'v1', status: 'RUNNING', definition_json: '{"nodes":[]}' }];
    const repo: any = {
      listRunsByStatus: vi.fn().mockResolvedValue(stuck),
      upsertRun: vi.fn(),
      markInflightNodeRunsInterrupted: vi.fn(),
      enqueueOutbox: vi.fn().mockResolvedValue(1),
    };
    const onRecover = vi.fn();
    await recoverOnLaunch({ repo, onRecover });
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'r1', status: 'INTERRUPTED' }));
    expect(repo.enqueueOutbox).toHaveBeenCalledWith('r1', 'run', 'r1', expect.objectContaining({ status: 'INTERRUPTED' }), 'terminal');
    expect(onRecover).toHaveBeenCalledWith(stuck);
  });
  it('resumeRun restores RUNNING + returns definition snapshot', async () => {
    const repo: any = {
      getRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'INTERRUPTED', definition_json: '{"nodes":[{"id":"n1"}]}' }),
      upsertRun: vi.fn(),
    };
    const r = await resumeRun(repo, 'r1');
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'r1', status: 'RUNNING' }));
    expect(r).toEqual({ runId: 'r1', definition: { nodes: [{ id: 'n1' }] } });
  });
  it('resumeRun returns null for non-INTERRUPTED run', async () => {
    const repo: any = { getRun: vi.fn().mockResolvedValue({ run_id: 'r1', status: 'SUCCEEDED' }), upsertRun: vi.fn() };
    expect(await resumeRun(repo, 'r1')).toBeNull();
    expect(repo.upsertRun).not.toHaveBeenCalled();
  });
});
