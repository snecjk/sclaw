import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostApiContext } from '@electron/api/context';

const parseJsonBodyMock = vi.fn();
const sendJsonMock = vi.fn();
const uploadOssFileMock = vi.fn();

vi.mock('electron', () => ({
  dialog: {},
  nativeImage: { createFromPath: vi.fn() },
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBodyMock(...args),
  sendJson: (...args: unknown[]) => sendJsonMock(...args),
}));

vi.mock('@electron/utils/artifact-path', () => ({
  resolveWorkspaceFilePath: (filePath: string) => filePath,
}));

vi.mock('@electron/utils/oss-temp-upload', () => ({
  uploadOssFile: (...args: unknown[]) => uploadOssFileMock(...args),
}));

import { handleFileRoutes } from '@electron/api/routes/files';

const ctx = {} as HostApiContext;
const res = {} as ServerResponse;
let tempDir: string;

describe('sto OSS tiny-file Host API route', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sto-oss-tinyfile-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    parseJsonBodyMock.mockReset();
    sendJsonMock.mockReset();
    uploadOssFileMock.mockReset();
    uploadOssFileMock.mockResolvedValue({
      tempUrl: 'https://oss.example.com/report.txt?sig=1',
      ossKey: 'claw_tiny_file/report.txt',
      resourceId: 'report.txt',
      fileType: 'txt',
      name: 'report.txt',
    });
  });

  it('resolves a relative path from cwd and forwards the new business type', async () => {
    const filePath = join(tempDir, 'report.txt');
    await writeFile(filePath, 'report');
    parseJsonBodyMock.mockResolvedValue({
      filePath: 'report.txt',
      cwd: tempDir,
      bizTypeEnum: 'claw_tiny_file',
      expiresSeconds: 604800,
      source: 'sto-oss-tinyfile',
    });

    expect(await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      res,
      new URL('http://localhost/api/files/upload-temp'),
      ctx,
    )).toBe(true);
    expect(uploadOssFileMock).toHaveBeenCalledWith(
      filePath,
      'report.txt',
      expect.objectContaining({
        bizTypeEnum: 'claw_tiny_file',
        expiresSeconds: 604800,
        logTag: 'sto-oss-tinyfile',
      }),
    );
    expect(sendJsonMock).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      url: 'https://oss.example.com/report.txt?sig=1',
      resourceId: 'report.txt',
    }));
  });

  it('accepts an absolute path outside the workspace', async () => {
    const filePath = join(tempDir, 'external.txt');
    await writeFile(filePath, 'external');
    parseJsonBodyMock.mockResolvedValue({
      filePath,
      bizTypeEnum: 'claw_tiny_file',
      expiresSeconds: 604800,
    });

    await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      res,
      new URL('http://localhost/api/files/upload-temp'),
      ctx,
    );
    expect(uploadOssFileMock).toHaveBeenCalledWith(filePath, 'external.txt', expect.any(Object));
  });

  it('rejects empty files before uploading', async () => {
    const filePath = join(tempDir, 'empty.txt');
    await writeFile(filePath, '');
    parseJsonBodyMock.mockResolvedValue({ filePath });

    await handleFileRoutes(
      { method: 'POST' } as IncomingMessage,
      res,
      new URL('http://localhost/api/files/upload-temp'),
      ctx,
    );
    expect(uploadOssFileMock).not.toHaveBeenCalled();
    expect(sendJsonMock).toHaveBeenCalledWith(res, 400, expect.objectContaining({
      errCode: 'OSS_FILE_EMPTY',
    }));
  });
});
