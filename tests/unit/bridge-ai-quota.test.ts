import { beforeEach, describe, expect, it } from 'vitest';
import { registerBridgeAiRun, unregisterBridgeAiRun } from '../../electron/main/services/jsbridge/bridge-ai-registry';
import { acquireBridgeAiQuota, resetBridgeAiQuotaForTests } from '../../electron/main/services/jsbridge/bridge-ai-quota';

describe('acquireBridgeAiQuota', () => {
  beforeEach(() => {
    resetBridgeAiQuotaForTests();
  });

  it('rejects when concurrent limit is reached', () => {
    registerBridgeAiRun({
      requestId: 'r1',
      sessionKey: 'agent:main:bridge-ai:demo:c1',
      appId: 'demo',
      webContentsId: 1,
      ownerId: 'r1',
      idempotencyKey: 'bridge-ai:r1',
      runId: null,
      startedAt: Date.now(),
    });
    const result = acquireBridgeAiQuota({
      appId: 'demo',
      perMinute: 6,
      concurrent: 1,
      sessionKey: 'agent:main:bridge-ai:demo:c2',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('AI_CONCURRENCY_EXCEEDED');
    unregisterBridgeAiRun('r1');
  });

  it('rejects when per-minute quota is exceeded', () => {
    for (let index = 0; index < 2; index += 1) {
      const acquired = acquireBridgeAiQuota({
        appId: 'quota-demo',
        perMinute: 2,
        concurrent: 5,
      });
      expect(acquired.ok).toBe(true);
      if (acquired.ok) acquired.release();
    }
    const blocked = acquireBridgeAiQuota({
      appId: 'quota-demo',
      perMinute: 2,
      concurrent: 5,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('AI_QUOTA_EXCEEDED');
  });

  it('rejects a second concurrent run on the same session key', () => {
    registerBridgeAiRun({
      requestId: 'r2',
      sessionKey: 'agent:main:bridge-ai:demo:c9',
      appId: 'demo',
      webContentsId: 2,
      ownerId: 'r2',
      idempotencyKey: 'bridge-ai:r2',
      runId: null,
      startedAt: Date.now(),
    });
    const result = acquireBridgeAiQuota({
      appId: 'demo',
      perMinute: 10,
      concurrent: 3,
      sessionKey: 'agent:main:bridge-ai:demo:c9',
    });
    expect(result.ok).toBe(false);
    unregisterBridgeAiRun('r2');
  });
});
