import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getListeningProcessIds,
  listGatewayChildProcessIds,
  terminateProcessIds,
  waitForPortFree,
} = vi.hoisted(() => ({
  getListeningProcessIds: vi.fn(),
  listGatewayChildProcessIds: vi.fn(),
  terminateProcessIds: vi.fn(),
  waitForPortFree: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/stoclaw-test-userdata',
  },
}));

vi.mock('../../electron/gateway/supervisor', () => ({
  getListeningProcessIds,
  listGatewayChildProcessIds,
  terminateOrphanedProcessIds: vi.fn(),
  terminateProcessIds,
  waitForPortFree,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('gateway process registry duplicate cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getListeningProcessIds.mockResolvedValue([]);
    listGatewayChildProcessIds.mockResolvedValue([]);
    terminateProcessIds.mockResolvedValue(undefined);
    waitForPortFree.mockResolvedValue(undefined);
  });

  it('terminates duplicate gateway children but keeps the managed pid', async () => {
    listGatewayChildProcessIds.mockResolvedValue([72927, 83681, 91087]);

    const { terminateDuplicateGatewayChildren } = await import('../../electron/gateway/process-registry');
    const killed = await terminateDuplicateGatewayChildren({
      keepPid: 91087,
      reason: 'test',
    });

    expect(killed).toEqual([72927, 83681]);
    expect(terminateProcessIds).toHaveBeenCalledWith(['72927', '83681']);
  });

  it('does nothing when only the managed gateway child is present', async () => {
    listGatewayChildProcessIds.mockResolvedValue([91087]);

    const { terminateDuplicateGatewayChildren } = await import('../../electron/gateway/process-registry');
    const killed = await terminateDuplicateGatewayChildren({
      keepPid: 91087,
      reason: 'test',
    });

    expect(killed).toEqual([]);
    expect(terminateProcessIds).not.toHaveBeenCalled();
  });

  it('prepareGatewayStartupPort reclaims the default port after duplicate cleanup', async () => {
    listGatewayChildProcessIds.mockResolvedValue([72927, 83681]);
    const findAvailablePort = vi.fn().mockResolvedValue(18789);

    const { prepareGatewayStartupPort } = await import('../../electron/gateway/process-registry');
    const port = await prepareGatewayStartupPort({
      defaultPort: 18789,
      findAvailablePort,
    });

    expect(port).toBe(18789);
    expect(terminateProcessIds).toHaveBeenCalledWith(['72927', '83681']);
    expect(waitForPortFree).toHaveBeenCalledWith(18789);
    expect(findAvailablePort).toHaveBeenCalledWith(18789);
  });

  it('reuses the owned Gateway port without waiting when keepPid still listens', async () => {
    getListeningProcessIds.mockResolvedValue(['91087']);
    const findAvailablePort = vi.fn().mockResolvedValue(18790);

    const { prepareGatewayStartupPort } = await import('../../electron/gateway/process-registry');
    const port = await prepareGatewayStartupPort({
      defaultPort: 18789,
      keepPid: 91087,
      preferredPort: 18789,
      findAvailablePort,
    });

    expect(port).toBe(18789);
    expect(waitForPortFree).not.toHaveBeenCalled();
    expect(findAvailablePort).not.toHaveBeenCalled();
  });

  it('falls back to an alternate port when the default is externally occupied', async () => {
    const findAvailablePort = vi.fn().mockResolvedValue(18790);

    const { prepareGatewayStartupPort } = await import('../../electron/gateway/process-registry');
    const port = await prepareGatewayStartupPort({
      defaultPort: 18789,
      findAvailablePort,
    });

    expect(port).toBe(18790);
    expect(waitForPortFree).toHaveBeenCalledWith(18789);
  });
});
