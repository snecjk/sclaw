import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoAppStatus: vi.fn(),
  pullStoApp: vi.fn(),
  pushStoApp: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  getStoAppStatus: (...args: unknown[]) => mocks.getStoAppStatus(...args),
  pullStoApp: (...args: unknown[]) => mocks.pullStoApp(...args),
  pushStoApp: (...args: unknown[]) => mocks.pushStoApp(...args),
}));

import { submitStoAppWithAutoPull } from '../../src/lib/sto-app-submit';

describe('submitStoAppWithAutoPull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoAppStatus.mockResolvedValue({
      syncState: 'synced',
      bound: true,
      available: true,
    });
  });

  it('pulls first then pushes when there is no conflict', async () => {
    mocks.pullStoApp.mockResolvedValue({
      ok: true,
      output: '已是最新',
      json: { action: 'already-synced' },
    });
    mocks.pushStoApp.mockResolvedValue({ ok: true, output: '提交成功' });

    const outcome = await submitStoAppWithAutoPull('ws-1', '更新应用');
    expect(mocks.pullStoApp).toHaveBeenCalled();
    expect(mocks.pushStoApp).toHaveBeenCalled();
    expect(mocks.pullStoApp.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.pushStoApp.mock.invocationCallOrder[0]);
    expect(outcome).toMatchObject({ kind: 'submitted', pulledAction: 'already-synced' });
  });

  it('stops on conflicts and does not push', async () => {
    mocks.pullStoApp.mockResolvedValue({
      ok: true,
      output: '有冲突',
      json: {
        action: 'conflicts',
        conflicts: [{ path: 'src/a.ts', kind: 'text', status: 'unresolved' }],
      },
    });

    const outcome = await submitStoAppWithAutoPull('ws-1', '更新应用');
    expect(mocks.pushStoApp).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('conflicts');
  });
});
