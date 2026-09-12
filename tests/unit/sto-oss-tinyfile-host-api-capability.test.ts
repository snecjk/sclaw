import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHostApiOssTinyFilePort } from '../../electron/agent-extensions/extensions/sto-oss-tinyfile/host-api-capability';

afterEach(() => vi.unstubAllGlobals());

describe('sto OSS tiny-file Host API capability', () => {
  it('uploads with the fixed business type and seven-day expiry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: 'https://oss.example.com/report.xlsx?sig=1',
      tempUrl: 'https://oss.example.com/report.xlsx?sig=1',
      ossKey: 'claw_tiny_file/report.xlsx',
      resourceId: 'report.xlsx',
      fileType: 'xlsx',
      name: 'report.xlsx',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const result = await createHostApiOssTinyFilePort().upload({
      filePath: 'output/report.xlsx',
      fileName: 'report.xlsx',
      cwd: 'D:/workspace',
      signal: controller.signal,
    });

    expect(result.url).toContain('oss.example.com');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3210/api/files/upload-temp',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      filePath: 'output/report.xlsx',
      fileName: 'report.xlsx',
      cwd: 'D:/workspace',
      bizTypeEnum: 'claw_tiny_file',
      expiresSeconds: 604800,
      source: 'sto-oss-tinyfile',
      includeDebugCurl: false,
    });
  });

  it('surfaces Host API errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false,
      errCode: 'OSS_FILE_NOT_FOUND',
      error: 'File not found',
    }), { status: 404 })));

    await expect(createHostApiOssTinyFilePort().upload({ filePath: 'missing.txt' }))
      .rejects.toThrow('File not found');
  });

  it('rejects incomplete success responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      url: 'https://oss.example.com/file',
    }), { status: 200 })));

    await expect(createHostApiOssTinyFilePort().upload({ filePath: 'file.txt' }))
      .rejects.toThrow('OSS upload response is incomplete');
  });
});
