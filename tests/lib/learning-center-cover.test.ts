import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLearningCoverSrc } from '@/lib/learning-center-cover';
import { invokeIpc } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ invokeIpc: vi.fn() }));
const mockedIpc = vi.mocked(invokeIpc);

describe('resolveLearningCoverSrc', () => {
  beforeEach(() => mockedIpc.mockReset());

  it('turns a main-process image fetch into a data URL', async () => {
    mockedIpc.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
      bodyBase64: 'abc123',
    });
    await expect(resolveLearningCoverSrc('https://oss.example/cover.jpg')).resolves.toBe(
      'data:image/jpeg;base64,abc123',
    );
    expect(mockedIpc).toHaveBeenCalledWith('preview:httpFetch', {
      url: 'https://oss.example/cover.jpg',
    });
  });

  it('falls back to the original URL when the main-process fetch fails', async () => {
    mockedIpc.mockResolvedValue({ ok: false, error: 'no electron' });
    await expect(resolveLearningCoverSrc('https://oss.example/cover.jpg')).resolves.toBe(
      'https://oss.example/cover.jpg',
    );
  });
});
