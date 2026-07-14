import { describe, it, expect, vi } from 'vitest';

// buildPrompt → getDataDir → app.getPath('userData')，vitest 里需 mock electron
const tempUserDataDir = vi.hoisted(() => {
  const path = require('node:path'); const os = require('node:os'); const fs = require('node:fs');
  const dir = path.join(os.tmpdir(), `stoclaw-wf-retry-test-${process.pid}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true }); return dir;
});
vi.mock('electron', () => ({ app: { getPath: () => tempUserDataDir, isPackaged: false, getAppPath: () => tempUserDataDir } }));

import { runAgentNodeWithRetry } from '../../electron/services/workflow-runtime/agent-retry';

const ctxOf = (overrides: any = {}) => ({
  runId: 'r1', workflowId: 'w1', versionId: 'v1', definition: {},
  repo: { incrementNodeAttempt: vi.fn(), upsertNodeRun: vi.fn(), enqueueOutbox: vi.fn().mockResolvedValue(1), insertEvent: vi.fn(), ...overrides.repo },
  emit: overrides.emit ?? vi.fn(),
});

describe('agent-retry', () => {
  it('retries on validation failure, succeeds attempt 2', async () => {
    const spec: any = { completionContract: { outputJsonSchema: { type: 'object', required: ['x'] }, maxAttempts: 2 } };
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({ status: 'succeeded', rawText: '{}', usage: { input_tokens: 1 } })   // 校验失败(无 x)
      .mockResolvedValueOnce({ status: 'succeeded', rawText: '{"x":1}', usage: { input_tokens: 1 } });
    const emit = vi.fn();
    const r = await runAgentNodeWithRetry(ctxOf({ emit }) as any,
      { id: 'n1', type: 'agent_data_fetch' } as any, spec, { invokeAgent, quota: async () => true });
    expect(r.status).toBe('succeeded');
    expect(invokeAgent).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('completion.retry_scheduled', expect.anything(), 'n1');
  });

  it('marks failed when quota exceeded (before any attempt)', async () => {
    const quota = vi.fn().mockResolvedValue(false);
    const invokeAgent = vi.fn();
    const r = await runAgentNodeWithRetry(ctxOf() as any,
      { id: 'n1' } as any, { completionContract: { outputJsonSchema: { type: 'object' } } } as any, { invokeAgent, quota });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/quota/i);
    expect(invokeAgent).not.toHaveBeenCalled();
  });

  it('marks failed after maxAttempts exhausted on repeated engine failure', async () => {
    const spec: any = { completionContract: { outputJsonSchema: { type: 'object', required: ['x'] }, maxAttempts: 2 } };
    const invokeAgent = vi.fn().mockResolvedValue({ status: 'failed', error: 'engine err', rawText: '' });
    const r = await runAgentNodeWithRetry(ctxOf() as any,
      { id: 'n1' } as any, spec, { invokeAgent, quota: async () => true });
    expect(r.status).toBe('failed');
    expect(invokeAgent).toHaveBeenCalledTimes(2);
  });

  it('does not retry when onIncomplete=manual_review', async () => {
    const spec: any = { completionContract: { outputJsonSchema: { type: 'object', required: ['x'] }, maxAttempts: 3, onIncomplete: 'manual_review' } };
    const invokeAgent = vi.fn().mockResolvedValue({ status: 'succeeded', rawText: '{}' });  // 校验失败
    const r = await runAgentNodeWithRetry(ctxOf() as any,
      { id: 'n1' } as any, spec, { invokeAgent, quota: async () => true });
    expect(r.status).toBe('failed');
    expect(invokeAgent).toHaveBeenCalledTimes(1);
  });
});
