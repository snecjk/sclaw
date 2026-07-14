import { describe, it, expect, vi } from 'vitest';

// 智能节点路径调 buildPrompt→getDataDir→app.getPath('userData')，需 mock electron
const tempUserDataDir = vi.hoisted(() => {
  const path = require('node:path'); const os = require('node:os'); const fs = require('node:fs');
  const dir = path.join(os.tmpdir(), `stoclaw-wf-engine-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true }); return dir;
});
vi.mock('electron', () => ({ app: { getPath: () => tempUserDataDir, isPackaged: false, getAppPath: () => tempUserDataDir } }));

import { createEngine } from '../../electron/services/workflow-runtime/engine';

describe('WorkflowRuntimeEngine', () => {
  it('runs a trigger→output flow to SUCCEEDED', async () => {
    const repo: any = {
      upsertRun: vi.fn(), upsertNodeRun: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1),
      listNodeRuns: vi.fn().mockResolvedValue([]), getRun: vi.fn(), insertEvent: vi.fn(),
    };
    const invokeAgent = vi.fn();
    const engine = createEngine({ repo, invokeAgent, postSync: vi.fn() } as any);
    await engine.startRun({ workflowId: 'w1', versionId: 'v1', runId: 'r1', input: {},
      definition: { nodes: [{ id: 'n1', type: 'trigger' }, { id: 'n2', type: 'output' }], edges: [{ source: 'n1', target: 'n2' }] },
      startedAt: 't' });
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'r1', status: 'SUCCEEDED' }));
    expect(repo.upsertNodeRun).toHaveBeenCalledWith(expect.objectContaining({ node_id: 'n1', status: 'SUCCEEDED' }));
    expect(repo.upsertNodeRun).toHaveBeenCalledWith(expect.objectContaining({ node_id: 'n2', status: 'SUCCEEDED' }));
    expect(invokeAgent).not.toHaveBeenCalled();
    expect(repo.enqueueOutbox).toHaveBeenCalledWith('r1', 'run', 'r1', expect.objectContaining({ status: 'SUCCEEDED' }), 'terminal');
  });

  it('marks run FAILED when a smart node fails', async () => {
    const repo: any = {
      upsertRun: vi.fn(), upsertNodeRun: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1),
      listNodeRuns: vi.fn().mockResolvedValue([]), getRun: vi.fn(), insertEvent: vi.fn(),
      incrementNodeAttempt: vi.fn(),
    };
    const invokeAgent = vi.fn().mockResolvedValue({ status: 'failed', error: 'boom', rawText: '' });
    const engine = createEngine({ repo, invokeAgent, postSync: vi.fn() } as any);
    await engine.startRun({ workflowId: 'w1', versionId: 'v1', runId: 'r1', input: {},
      definition: { nodes: [{ id: 'n1', type: 'agent_data_fetch', config: { businessConfig: { kind: 'agent_data_fetch' } } }], edges: [] },
      startedAt: 't' });
    expect(repo.upsertRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'r1', status: 'FAILED', error: 'boom' }));
    expect(repo.enqueueOutbox).toHaveBeenCalledWith('r1', 'run', 'r1', expect.objectContaining({ status: 'FAILED' }), 'terminal');
  });
});
