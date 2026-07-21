import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockExec, mockLoggerWarn } = vi.hoisted(() => ({
  mockExec: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: mockExec,
    default: {
      ...actual,
      exec: mockExec,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/stoclaw-test-userdata',
    getAppPath: () => '/tmp/stoclaw-test-app',
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('execWindowsTaskKill', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('resolves when taskkill callback fires', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err?: Error | null) => void) => {
      const child = { on: vi.fn() };
      queueMicrotask(() => cb(null));
      return child;
    });

    const { execWindowsTaskKill } = await import('../../electron/gateway/supervisor');
    await expect(execWindowsTaskKill(12345, 1000)).resolves.toBeUndefined();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('resolves via hard timeout when exec callback never fires', async () => {
    mockExec.mockImplementation(() => {
      return { on: vi.fn() };
    });

    const { execWindowsTaskKill } = await import('../../electron/gateway/supervisor');
    const started = Date.now();
    await expect(execWindowsTaskKill(99999, 50)).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('taskkill hard-timeout for pid=99999'),
    );
  });

  it('ignores invalid pid values', async () => {
    const { execWindowsTaskKill } = await import('../../electron/gateway/supervisor');
    await expect(execWindowsTaskKill('abc', 50)).resolves.toBeUndefined();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
