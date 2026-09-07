import { describe, expect, it } from 'vitest';
import { waitForCondition, waitForReadyState } from '../../electron/services/browser-automation/wait-engine';

describe('waitForReadyState', () => {
  it('命中 interactive/complete 立即返回', async () => {
    const result = await waitForReadyState(
      {
        webContents: { isDestroyed: () => false } as import('electron').WebContents,
        executeJavaScript: async () => 'complete',
        getPendingRequestCount: () => 0,
      },
      ['interactive', 'complete'],
      1_000,
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('complete');
  });

  it('探测值不是字符串时不空转到超时（假 webContents / 注入失败）', async () => {
    const started = Date.now();
    const result = await waitForReadyState(
      {
        webContents: { isDestroyed: () => false } as import('electron').WebContents,
        executeJavaScript: async () => ({ url: 'https://example.com/' }),
        getPendingRequestCount: () => 0,
      },
      ['interactive', 'complete'],
      5_000,
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('unavailable');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('waitForCondition networkIdle', () => {
  it('每次轮询读取 getPendingRequestCount，不冻结首次快照', async () => {
    let pending = 2;
    const resultPromise = waitForCondition(
      {
        webContents: {
          isDestroyed: () => false,
          isLoading: () => false,
        } as import('electron').WebContents,
        executeJavaScript: async () => ({}),
        getPendingRequestCount: () => pending,
      },
      { type: 'networkIdle', timeoutMs: 2_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    pending = 0;
    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.message).toBe('Network idle');
  });
});
