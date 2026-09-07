import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostApiScheduledTaskPort } from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/host-api-capability';

afterEach(() => vi.unstubAllGlobals());

describe('sto scheduled-task Host API capability', () => {
  it('resolves session defaults and creates through the Main-process API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        accountId: 'account-1', agentId: 'main', model: 'model-1', workspacePath: 'D:/workspace',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'task-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const port = createHostApiScheduledTaskPort();

    await expect(port.resolveDefaults('agent:main:chat')).resolves.toMatchObject({
      agentId: 'main', workspacePath: 'D:/workspace',
    });
    await port.create({
      engineType: 'pi', agentId: 'main', cronExpr: '0 9 * * *', name: '日报',
      prompt: '生成日报', workspacePath: 'D:/workspace',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:3210/api/scheduled-tasks/context?sessionKey=agent%3Amain%3Achat',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:3210/api/scheduled-tasks',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces Host API errors without changing their business message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: '无权修改他人定时任务' }),
      { status: 403 },
    )));
    await expect(createHostApiScheduledTaskPort().delete('task-1'))
      .rejects.toThrow('无权修改他人定时任务');
  });
});
