import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStoAppStatus: vi.fn(),
  pullStoApp: vi.fn(),
  pushStoApp: vi.fn(),
  listStoAppConflicts: vi.fn(),
  continueStoAppMerge: vi.fn(),
}));

vi.mock('@/lib/app-dev-api', () => ({
  getStoAppStatus: (...args: unknown[]) => mocks.getStoAppStatus(...args),
  pullStoApp: (...args: unknown[]) => mocks.pullStoApp(...args),
  pushStoApp: (...args: unknown[]) => mocks.pushStoApp(...args),
  listStoAppConflicts: (...args: unknown[]) => mocks.listStoAppConflicts(...args),
  continueStoAppMerge: (...args: unknown[]) => mocks.continueStoAppMerge(...args),
}));

import { submitStoAppWithAutoPull } from '../../src/lib/sto-app-submit';

describe('submitStoAppWithAutoPull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoAppStatus.mockResolvedValue({
      syncState: 'local-changes',
      bound: true,
      available: true,
      revisionId: 'rev-1',
    });
    mocks.listStoAppConflicts.mockResolvedValue([]);
  });

  it('pushes directly when local-changes without always pulling', async () => {
    mocks.pushStoApp.mockResolvedValue({ ok: true, output: '提交成功' });

    const outcome = await submitStoAppWithAutoPull('ws-1', '更新应用');
    expect(mocks.pullStoApp).not.toHaveBeenCalled();
    expect(mocks.pushStoApp).toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'submitted' });
  });

  it('pulls first when remote-ahead', async () => {
    mocks.getStoAppStatus.mockResolvedValue({
      syncState: 'remote-ahead',
      bound: true,
      available: true,
      revisionId: 'rev-1',
      remoteRevisionId: 'rev-2',
    });
    mocks.pullStoApp.mockResolvedValue({
      ok: true,
      output: '拉取成功',
      json: { action: 'applied' },
    });
    mocks.pushStoApp.mockResolvedValue({ ok: true, output: '提交成功' });

    const outcome = await submitStoAppWithAutoPull('ws-1', '更新应用');
    expect(mocks.pullStoApp).toHaveBeenCalled();
    expect(mocks.pushStoApp).toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'submitted', pulledAction: 'applied' });
  });

  it('stops on conflicts from pull and does not push', async () => {
    mocks.getStoAppStatus.mockResolvedValue({
      syncState: 'remote-ahead',
      bound: true,
      available: true,
    });
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

  it('auto continues merge when markers are cleared then pushes', async () => {
    mocks.getStoAppStatus
      .mockResolvedValueOnce({
        syncState: 'merge-required',
        bound: true,
        available: true,
        mergeTheirsRevisionId: 'rev-2',
        conflicts: [{ path: 'src/a.ts', kind: 'text', status: 'unresolved' }],
      })
      .mockResolvedValue({
        syncState: 'local-changes',
        bound: true,
        available: true,
        mergeTheirsRevisionId: 'rev-2',
      });
    mocks.listStoAppConflicts.mockResolvedValue([]);
    mocks.continueStoAppMerge.mockResolvedValue({ ok: true, output: 'ok' });
    mocks.pushStoApp.mockResolvedValue({ ok: true, output: '提交成功' });

    const outcome = await submitStoAppWithAutoPull('ws-1', '更新应用');
    expect(mocks.continueStoAppMerge).toHaveBeenCalledWith('ws-1', 'rev-2');
    expect(mocks.pushStoApp).toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: 'submitted', pulledAction: 'merged' });
  });
});
