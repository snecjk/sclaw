import { describe, expect, it, vi } from 'vitest';

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  AGENT_MEMORY_WARMUP_MAX_ATTEMPTS,
  initializeAgentMemoryWithRetry,
} from '@electron/services/agent-memory-context-service';

const enabledStatus = {
  ready: true,
  storageReady: true,
  sdkAvailable: true,
  mode: 'phase1-remote-orchestrated' as const,
  paths: {
    baseDir: '',
    historyDbPath: '',
    configPath: '',
    queuePath: '',
    vectorCacheDir: '',
    userIdPath: '',
  },
  bootstrap: { enabled: true, appId: 'sto-claw', userId: 'user-1' },
};

describe('Agent Memory startup warmup retry', () => {
  it('retries rejected initialization up to the configured maximum', async () => {
    const initialize = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure 1'))
      .mockRejectedValueOnce(new Error('temporary failure 2'))
      .mockResolvedValue(enabledStatus);

    await expect(initializeAgentMemoryWithRetry(initialize, { baseDelayMs: 0 }))
      .resolves.toEqual(enabledStatus);
    expect(initialize).toHaveBeenCalledTimes(AGENT_MEMORY_WARMUP_MAX_ATTEMPTS);
  });

  it('does not retry a resolved disabled status', async () => {
    const disabledStatus = {
      ...enabledStatus,
      ready: false,
      bootstrap: { ...enabledStatus.bootstrap, enabled: false },
    };
    const initialize = vi.fn().mockResolvedValue(disabledStatus);

    await expect(initializeAgentMemoryWithRetry(initialize, { baseDelayMs: 0 }))
      .resolves.toEqual(disabledStatus);
    expect(initialize).toHaveBeenCalledOnce();
  });

  it('throws after all startup attempts fail', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('bootstrap unavailable'));

    await expect(initializeAgentMemoryWithRetry(initialize, { baseDelayMs: 0 }))
      .rejects.toThrow('bootstrap unavailable');
    expect(initialize).toHaveBeenCalledTimes(AGENT_MEMORY_WARMUP_MAX_ATTEMPTS);
  });
});
