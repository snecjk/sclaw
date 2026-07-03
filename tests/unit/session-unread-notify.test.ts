import { beforeEach, describe, expect, it, vi } from 'vitest';

const markUnreadMock = vi.fn();
const getReadAtMock = vi.fn<(key: string) => number>(() => 0);

vi.mock('@/stores/session-unread', () => ({
  useSessionUnreadStore: {
    getState: () => ({ markSessionUnread: markUnreadMock }),
  },
  getSessionReadAt: (key: string) => getReadAtMock(key),
}));

vi.mock('@/lib/session-unread-keys', () => ({
  canonicalSessionUnreadKey: (key: string) => key.trim(),
}));

const IMPORT_TIME = 1_000_000_000_000;
let clock = IMPORT_TIME;

vi.spyOn(Date, 'now').mockImplementation(() => clock);

type NotifyModule = typeof import('@/lib/session-unread-notify');

async function loadModule(): Promise<NotifyModule> {
  vi.resetModules();
  clock = IMPORT_TIME; // moduleLoadedAt is captured at import → equals IMPORT_TIME
  const mod = await import('@/lib/session-unread-notify');
  return mod;
}

describe('markSessionUnreadAfterSuccessfulRun', () => {
  beforeEach(() => {
    markUnreadMock.mockReset();
    getReadAtMock.mockReset();
    getReadAtMock.mockReturnValue(0);
  });

  it('marks unread for an observed run past the startup grace when not recently read', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 10_000; // past 5s startup grace
    mod.noteObservedRun('run-1');

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b', {
      runId: 'run-1',
    });

    expect(markUnreadMock).toHaveBeenCalledWith('agent:main:session-a');
  });

  it('skips when the run was not observed in this app instance (replay guard)', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 10_000;

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b', {
      runId: 'run-unseen',
    });

    expect(markUnreadMock).not.toHaveBeenCalled();
  });

  it('skips when no runId is provided', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 10_000;

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b');

    expect(markUnreadMock).not.toHaveBeenCalled();
  });

  it('skips during the startup grace window (replay burst guard)', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 1_000; // still within 5s grace
    mod.noteObservedRun('run-1');

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b', {
      runId: 'run-1',
    });

    expect(markUnreadMock).not.toHaveBeenCalled();
  });

  it('skips when the session was read recently (viewed-then-left guard)', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 10_000;
    mod.noteObservedRun('run-1');
    getReadAtMock.mockReturnValue(clock - 5_000); // read 5s ago, within 20s grace

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b', {
      runId: 'run-1',
    });

    expect(markUnreadMock).not.toHaveBeenCalled();
  });

  it('marks unread when the last read was long ago', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 100_000;
    mod.noteObservedRun('run-1');
    getReadAtMock.mockReturnValue(clock - 30_000); // read 30s ago, beyond 20s grace

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-b', {
      runId: 'run-1',
    });

    expect(markUnreadMock).toHaveBeenCalledWith('agent:main:session-a');
  });

  it('skips when the completing session is the current session', async () => {
    const mod = await loadModule();
    clock = IMPORT_TIME + 10_000;
    mod.noteObservedRun('run-1');

    mod.markSessionUnreadAfterSuccessfulRun('agent:main:session-a', 'agent:main:session-a', {
      runId: 'run-1',
    });

    expect(markUnreadMock).not.toHaveBeenCalled();
  });
});
