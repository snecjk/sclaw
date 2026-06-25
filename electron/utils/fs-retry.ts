/**
 * Filesystem helpers with retry for Windows file-lock errors (EBUSY/EPERM/etc.).
 */
import fs from 'fs';
import { logger } from './logger';

const WIN32_RETRIABLE_REMOVE_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EEXIST']);

export function isRetriableRemoveError(err: NodeJS.ErrnoException): boolean {
  const code = err.code ?? '';
  if (process.platform === 'win32') {
    return WIN32_RETRIABLE_REMOVE_CODES.has(code);
  }
  return code === 'EBUSY';
}

export function formatSkillDirLockedError(dir: string, err?: NodeJS.ErrnoException): Error {
  const code = err?.code ? ` (${err.code})` : '';
  return new Error(
    `技能目录被占用，无法更新。请关闭占用该文件夹的程序（如资源管理器、编辑器等）后重试。${code}`,
  );
}

export async function safeRemoveDir(
  dir: string,
  options?: { maxRetries?: number; label?: string },
): Promise<void> {
  const maxRetries = options?.maxRetries ?? (process.platform === 'win32' ? 6 : 3);
  const label = options?.label ?? dir;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (isRetriableRemoveError(err) && i < maxRetries - 1) {
        const delayMs = 500 * (i + 1);
        logger.warn(
          `[safeRemoveDir] ${err.code} on ${label}, retrying in ${delayMs}ms (attempt ${i + 1}/${maxRetries})`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      if (isRetriableRemoveError(err)) {
        throw formatSkillDirLockedError(label, err);
      }
      throw error;
    }
  }
}
