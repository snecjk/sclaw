import { beforeEach, describe, expect, it, vi } from 'vitest';

const stop = vi.fn();
const forceTerminateOwnedProcessForQuit = vi.fn();
const getListeningProcessIds = vi.fn();
const terminateOrphanedProcessIds = vi.fn();
const clearOwnedGatewayProcess = vi.fn();

vi.mock('../../electron/gateway/supervisor', () => ({
  getListeningProcessIds,
  terminateOrphanedProcessIds,
}));

vi.mock('../../electron/gateway/process-registry', () => ({
  clearOwnedGatewayProcess,
}));

vi.mock('../../electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('shutdownGatewayForQuit', () => {
  beforeEach(() => {
    vi.resetModules();
    stop.mockReset();
    forceTerminateOwnedProcessForQuit.mockReset();
    getListeningProcessIds.mockReset();
    terminateOrphanedProcessIds.mockReset();
    clearOwnedGatewayProcess.mockReset();
    stop.mockResolvedValue(undefined);
    forceTerminateOwnedProcessForQuit.mockResolvedValue(false);
    getListeningProcessIds.mockResolvedValue([]);
  });

  it('skips force-terminate when stop finishes within the fast quit budget', async () => {
    const gatewayManager = {
      stop,
      forceTerminateOwnedProcessForQuit,
      getStatus: () => ({ port: 18789 }),
    };

    const { shutdownGatewayForQuit } = await import('../../electron/main/gateway-quit-cleanup');
    await shutdownGatewayForQuit(gatewayManager as never);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(forceTerminateOwnedProcessForQuit).not.toHaveBeenCalled();
    expect(clearOwnedGatewayProcess).toHaveBeenCalledTimes(1);
  });

  it('kills remaining listeners on the gateway port after stop', async () => {
    getListeningProcessIds.mockResolvedValue(['9999']);
    terminateOrphanedProcessIds.mockResolvedValue(undefined);

    const gatewayManager = {
      stop,
      forceTerminateOwnedProcessForQuit,
      getStatus: () => ({ port: 18789 }),
    };

    const { shutdownGatewayForQuit } = await import('../../electron/main/gateway-quit-cleanup');
    await shutdownGatewayForQuit(gatewayManager as never);

    expect(terminateOrphanedProcessIds).toHaveBeenCalledWith(18789, ['9999']);
  });

  it('force-terminates when stop exceeds the fast quit budget', async () => {
    vi.useFakeTimers();
    stop.mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      }),
    );
    forceTerminateOwnedProcessForQuit.mockResolvedValue(true);

    const gatewayManager = {
      stop,
      forceTerminateOwnedProcessForQuit,
      getStatus: () => ({ port: 18789 }),
    };

    const { shutdownGatewayForQuit, QUIT_GATEWAY_FAST_STOP_MS } = await import(
      '../../electron/main/gateway-quit-cleanup'
    );

    const cleanupPromise = shutdownGatewayForQuit(gatewayManager as never);
    await vi.advanceTimersByTimeAsync(QUIT_GATEWAY_FAST_STOP_MS + 100);
    await cleanupPromise;

    expect(forceTerminateOwnedProcessForQuit).toHaveBeenCalledTimes(1);
    expect(clearOwnedGatewayProcess).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
