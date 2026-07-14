import { describe, it, expect, vi } from 'vitest';
import { invokeAgent, cancelAgent } from '../../electron/services/workflow-runtime/agent-runner';

// `makeQuery` returns an INVOKED async generator (an async iterable), matching the
// real SDK's `query()` shape. The task's draft returned an un-invoked generator
// function, which `for await...of` cannot iterate.
const makeQuery = (msgs: any[]) =>
  (async function* () {
    for (const m of msgs) yield m;
  })();

describe('agent-runner', () => {
  it('returns result text + usage on success', async () => {
    const sdk = {
      query: vi.fn().mockReturnValue(
        makeQuery([
          { type: 'assistant', message: { content: [{ type: 'text', text: '{"x":1}' }] } },
          { type: 'result', subtype: 'success', result: '{"x":1}', usage: { input_tokens: 10, output_tokens: 5 } },
        ]),
      ),
    };
    const r = await invokeAgent({ sdk, ctx: { runId: 'r1', nodeId: 'n1' } as any, prompt: 'p', env: {}, cwd: '/tmp' });
    expect(r.status).toBe('succeeded');
    expect(r.rawText).toContain('{"x":1}');
    expect(r.usage?.input_tokens).toBe(10);
  });

  it('watchdog kills on no-progress (stalled stream)', async () => {
    const stalled = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'start' }] } };
      await new Promise(() => {}); // never resumes
    };
    const sdk = { query: vi.fn().mockReturnValue(stalled()) };
    const r = await invokeAgent({
      sdk,
      ctx: { runId: 'r1', nodeId: 'n1' } as any,
      prompt: 'p',
      env: {},
      cwd: '/tmp',
      noProgressMs: 50,
      deadlineMs: 1000,
    });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/超时|timeout/i);
  });

  it('cancel via cancelAgent closes the active query', async () => {
    let closed = false;
    const stalled = async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 's' }] } };
      await new Promise(() => {});
    };
    // Attach `close` to the invoked async generator so the mock is BOTH an async
    // iterable AND has a `close()` (the real SDK shape). The task's draft used
    // `{ ...(stalled()), close }`, whose spread drops Symbol.asyncIterator.
    const query = stalled() as any;
    query.close = () => {
      closed = true;
    };
    const sdk = { query: vi.fn().mockReturnValue(query) };
    const p = invokeAgent({
      sdk,
      ctx: { runId: 'r1', nodeId: 'n1' } as any,
      prompt: 'p',
      env: {},
      cwd: '/tmp',
      noProgressMs: 1000,
      deadlineMs: 60000,
    });
    await new Promise((r) => setTimeout(r, 20));
    cancelAgent('r1', 'n1');
    const r = await p;
    expect(closed).toBe(true);
    expect(r.status).toBe('failed');
  });
});
