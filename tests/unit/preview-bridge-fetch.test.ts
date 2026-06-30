import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeIpcMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

describe('preview-bridge-fetch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('forwards allowedOrigin to preview:httpFetch IPC', async () => {
    invokeIpcMock.mockResolvedValueOnce({ ok: true, status: 200, bodyBase64: 'e30=' });

    const { previewBridgeHttpFetch } = await import('@/lib/preview-bridge-fetch');
    const result = await previewBridgeHttpFetch({
      url: 'https://cdn.example.com/api/report',
      allowedOrigin: 'https://cdn.example.com',
      method: 'POST',
      body: '{}',
    });

    expect(result.ok).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('preview:httpFetch', {
      url: 'https://cdn.example.com/api/report',
      allowedOrigin: 'https://cdn.example.com',
      method: 'POST',
      body: '{}',
    });
  });
});
