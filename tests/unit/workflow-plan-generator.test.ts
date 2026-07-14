import { describe, it, expect, vi } from 'vitest';
import { generatePlan } from '../../electron/services/workflow-runtime/plan-generator';
const fakeDslClient = { fetchVersion: vi.fn().mockResolvedValue({ definition: {
  nodes: [{id:'n1',type:'trigger'},{id:'n2',type:'output'}], edges: [{source:'n1',target:'n2'}] } }) };

describe('generatePlan', () => {
  it('creates wf_run with definition snapshot + PENDING node_runs', async () => {
    const repo: any = { upsertRun: vi.fn(), upsertNodeRun: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1) };
    const runId = await generatePlan({ repo, dslClient: fakeDslClient, workflowId: 'w1',
      versionId: 'v1', runId: 'r1', input: {a:1}, startedAt: 't' } as any);
    expect(runId).toBe('r1');
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ run_id:'r1', status:'RUNNING', mode:'CLIENT_LOCAL' }));
    expect(repo.upsertNodeRun).toHaveBeenCalledTimes(2);
    expect(repo.enqueueOutbox).toHaveBeenCalled();
  });
});
