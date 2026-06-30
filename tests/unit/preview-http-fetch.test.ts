import { describe, expect, it, vi } from 'vitest';
import {
  executePreviewHttpFetch,
  validatePreviewHttpFetchRequest,
} from '../../electron/main/ipc/preview-http-fetch';

describe('preview-http-fetch', () => {
  const artifactOrigin = 'https://cdn.example.com';
  const apiUrl = `${artifactOrigin}/reports/api/data`;

  it('rejects non-http URLs', () => {
    expect(validatePreviewHttpFetchRequest({ url: 'file:///etc/passwd' })).toMatch(/Invalid/);
  });

  it('rejects cross-origin when allowedOrigin is set', () => {
    expect(validatePreviewHttpFetchRequest({
      url: 'https://evil.example.com/steal',
      allowedOrigin: artifactOrigin,
    })).toMatch(/origin mismatch/);
  });

  it('accepts same-origin URL with allowedOrigin', () => {
    expect(validatePreviewHttpFetchRequest({
      url: apiUrl,
      allowedOrigin: artifactOrigin,
    })).toBeNull();
  });

  it('proxies fetch and returns base64 body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      arrayBuffer: async () => Buffer.from('{"ok":true}'),
    });

    const result = await executePreviewHttpFetch({
      url: apiUrl,
      allowedOrigin: artifactOrigin,
    }, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.headers?.['content-type']).toBe('application/json');
    expect(Buffer.from(result.bodyBase64!, 'base64').toString('utf-8')).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledWith(apiUrl, expect.objectContaining({ method: 'GET' }));
  });

  it('returns HTTP error status without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      headers: new Headers(),
      arrayBuffer: async () => Buffer.from('not found'),
    });

    const result = await executePreviewHttpFetch({
      url: apiUrl,
      allowedOrigin: artifactOrigin,
    }, fetchMock);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(404);
    expect(Buffer.from(result.bodyBase64!, 'base64').toString('utf-8')).toBe('not found');
  });

  it('surfaces network failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

    const result = await executePreviewHttpFetch({
      url: apiUrl,
      allowedOrigin: artifactOrigin,
    }, fetchMock);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNRESET');
  });
});
