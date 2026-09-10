import { describe, expect, it, vi } from 'vitest';
import { createSignalQuitHandler } from '@electron/main/signal-quit';

describe('signal quit handler', () => {
  it('logs and requests quit when signal is received', () => {
    const logInfo = vi.fn();
    const requestQuit = vi.fn();
    const forceExit = vi.fn();
    const handler = createSignalQuitHandler({ logInfo, requestQuit, forceExit, forceExitDelayMs: 60_000 });

    handler('SIGTERM');

    expect(logInfo).toHaveBeenCalledWith('Received SIGTERM; requesting app quit');
    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it('forces immediate exit on repeated signal', () => {
    const logInfo = vi.fn();
    const requestQuit = vi.fn();
    const forceExit = vi.fn();
    const handler = createSignalQuitHandler({ logInfo, requestQuit, forceExit });

    handler('SIGINT');
    handler('SIGINT');

    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(130);
  });
});
