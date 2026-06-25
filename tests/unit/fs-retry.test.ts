import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

vi.mock('../../electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

describe('fs-retry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('retries retriable remove errors and eventually succeeds on Windows', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });

    const rm = vi
      .spyOn(fs.promises, 'rm')
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))
      .mockRejectedValueOnce(Object.assign(new Error('perm'), { code: 'EPERM' }))
      .mockResolvedValue(undefined);

    const { safeRemoveDir } = await import('../../electron/utils/fs-retry');
    await safeRemoveDir('/tmp/skill-dir', { maxRetries: 4, label: 'skill-dir' });

    expect(rm).toHaveBeenCalledTimes(3);
  });

  it('throws a user-friendly message after exhausting retries on Windows', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });

    vi.spyOn(fs.promises, 'rm').mockRejectedValue(
      Object.assign(new Error('perm'), { code: 'EPERM' }),
    );

    const { safeRemoveDir } = await import('../../electron/utils/fs-retry');
    await expect(safeRemoveDir('/tmp/skill-dir', { maxRetries: 2, label: 'skill-dir' }))
      .rejects
      .toThrow('技能目录被占用');
  });

  it('does not retry non-retriable errors', async () => {
    const rm = vi.spyOn(fs.promises, 'rm').mockRejectedValue(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    const { safeRemoveDir } = await import('../../electron/utils/fs-retry');
    await expect(safeRemoveDir('/tmp/skill-dir', { maxRetries: 4 }))
      .rejects
      .toMatchObject({ code: 'ENOENT' });

    expect(rm).toHaveBeenCalledTimes(1);
  });
});
