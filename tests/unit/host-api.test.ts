import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('resolveHostApiFetchTimeoutMs', () => {
  it('maps disableTimeout to 0 and otherwise keeps timeoutMs', async () => {
    const { resolveHostApiFetchTimeoutMs } = await import('@/lib/host-api');
    expect(resolveHostApiFetchTimeoutMs({ disableTimeout: true })).toBe(0);
    expect(resolveHostApiFetchTimeoutMs({ disableTimeout: true, timeoutMs: 120_000 })).toBe(0);
    expect(resolveHostApiFetchTimeoutMs({ timeoutMs: 120_000 })).toBe(120_000);
    expect(resolveHostApiFetchTimeoutMs({})).toBeUndefined();
  });
});

describe('host-api', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.removeItem('stoclaw:allow-localhost-fallback');
  });

  it('uses IPC proxy and returns unified envelope json', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 200,
        ok: true,
        json: { success: true },
      },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ success: boolean }>('/api/settings');

    expect(result.success).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({ path: '/api/settings', method: 'GET' }),
    );
  });

  it('forwards disableTimeout as timeoutMs: 0 to the IPC proxy', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { ok: 1 } },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    await hostApiFetch('/api/app-dev/sto-app/deploy', {
      method: 'POST',
      body: '{}',
      disableTimeout: true,
    });

    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/app-dev/sto-app/deploy',
        timeoutMs: 0,
      }),
    );
  });

  it('forwards explicit timeoutMs when disableTimeout is not set', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: { status: 200, ok: true, json: { ok: 1 } },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    await hostApiFetch('/api/app-dev/sto-app/push', {
      method: 'POST',
      body: '{}',
      timeoutMs: 120_000,
    });

    expect(invokeIpcMock).toHaveBeenCalledWith(
      'hostapi:fetch',
      expect.objectContaining({
        path: '/api/app-dev/sto-app/push',
        timeoutMs: 120_000,
      }),
    );
  });

  it('supports legacy proxy envelope response', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      status: 200,
      ok: true,
      json: { ok: 1 },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ ok: number }>('/api/settings');
    expect(result.ok).toBe(1);
  });

  it('falls back to browser fetch when hostapi handler is not registered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('stoclaw:allow-localhost-fallback', '1');

    invokeIpcMock.mockResolvedValueOnce({
      ok: false,
      error: { message: 'No handler registered for hostapi:fetch' },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ fallback: boolean }>('/api/test');

    expect(result.fallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/test',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('throws message from legacy non-ok envelope', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      success: true,
      ok: false,
      status: 401,
      json: { error: 'Invalid Authentication' },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    await expect(hostApiFetch('/api/test')).rejects.toThrow('Invalid Authentication');
  });

  it('throws when unified envelope carries HTTP 4xx/5xx (IPC ok but upstream failed)', async () => {
    invokeIpcMock.mockResolvedValueOnce({
      ok: true,
      data: {
        status: 500,
        ok: false,
        json: { success: false, error: 'ENOENT: no such file' },
      },
    });

    const { hostApiFetch } = await import('@/lib/host-api');
    await expect(hostApiFetch('/api/files/read')).rejects.toThrow('ENOENT: no such file');
  });

  it('falls back to browser fetch only when IPC channel is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem('stoclaw:allow-localhost-fallback', '1');

    invokeIpcMock.mockRejectedValueOnce(new Error('Invalid IPC channel: hostapi:fetch'));

    const { hostApiFetch } = await import('@/lib/host-api');
    const result = await hostApiFetch<{ fallback: boolean }>('/api/test');

    expect(result.fallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/test',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('does not use localhost fallback when policy flag is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ fallback: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    invokeIpcMock.mockRejectedValueOnce(new Error('Invalid IPC channel: hostapi:fetch'));

    const { hostApiFetch } = await import('@/lib/host-api');
    await expect(hostApiFetch('/api/test')).rejects.toThrow('Invalid IPC channel: hostapi:fetch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
