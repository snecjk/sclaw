/**
 * Squirrel.Mac (electron-updater on macOS) renames the existing .app bundle to
 * `{Name}.app.old-{timestamp}` during in-place updates. ShipIt should delete it
 * after a successful swap, but the backup is often left behind in /Applications.
 *
 * During the swap the backup may briefly exist as a file/symlink before becoming
 * a full `.app` directory — do not require `isDirectory()` before removal.
 *
 * Node `fs.rm(recursive)` often fails on macOS app bundles (ENOTEMPTY under
 * Contents/Resources/app.asar); use `/bin/rm -rf` instead.
 */
import { execFile } from 'node:child_process';
import { app } from 'electron';
import { lstat, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { logger } from './logger';

const execFileAsync = promisify(execFile);

/** Retries after launch: ShipIt may still be renaming `.old-*` into a bundle. */
export const CLEANUP_RETRY_DELAYS_MS = [0, 30_000, 120_000, 300_000] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Resolve install dir + bundle name from a packaged macOS exec path. */
export function getMacAppBundleInfo(
  execPath: string,
): { installDir: string; bundleName: string; bundlePath: string } | null {
  const normalized = resolve(execPath);
  const bundlePath = resolve(normalized, '..', '..', '..');
  if (!bundlePath.endsWith('.app')) {
    return null;
  }
  return {
    installDir: resolve(bundlePath, '..'),
    bundleName: basename(bundlePath),
    bundlePath,
  };
}

/** True for Squirrel backup names like `SClaw.app.old-1780371448851`. */
export function isOldAppBackupName(bundleName: string, entryName: string): boolean {
  const pattern = new RegExp(`^${escapeRegExp(bundleName)}\\.old-\\d+$`);
  return pattern.test(entryName);
}

async function describeEntry(target: string): Promise<string> {
  try {
    const st = await lstat(target);
    if (st.isDirectory()) return 'directory';
    if (st.isFile()) return 'file';
    if (st.isSymbolicLink()) return 'symlink';
    return 'other';
  } catch {
    return 'unknown';
  }
}

/** Delete a path on macOS; falls back when Node fs.rm hits ENOTEMPTY on .app bundles. */
export async function removeMacAppBackupPath(target: string): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('/bin/rm', ['-rf', target]);
      return;
    } catch (error) {
      logger.warn(`[Updater] /bin/rm -rf failed for ${target}, retrying with fs.rm:`, error);
    }
  }

  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

/** Remove all sibling `.app.old-*` backups next to the running app bundle. */
export async function cleanupOldMacAppBackups(execPath: string): Promise<string[]> {
  const info = getMacAppBundleInfo(execPath);
  if (!info) {
    logger.warn('[Updater] Old app backup cleanup skipped: could not resolve .app bundle path');
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(info.installDir);
  } catch (error) {
    logger.warn('[Updater] Could not read install directory for old backup cleanup:', error);
    return [];
  }

  const candidates = entries.filter((name) => isOldAppBackupName(info.bundleName, name));
  if (candidates.length === 0) {
    return [];
  }

  logger.info(
    `[Updater] Found ${candidates.length} old app backup(s) in ${info.installDir}: ${candidates.join(', ')}`,
  );

  const removed: string[] = [];
  for (const name of candidates) {
    const target = join(info.installDir, name);
    if (resolve(target) === resolve(info.bundlePath)) {
      continue;
    }

    const kind = await describeEntry(target);
    try {
      await removeMacAppBackupPath(target);
      removed.push(target);
      logger.info(`[Updater] Removed old app backup (${kind}): ${target}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        continue;
      }
      logger.warn(
        `[Updater] Failed to remove old app backup (${kind}) ${target}:`,
        error,
      );
    }
  }

  if (removed.length > 0) {
    logger.info(`[Updater] Cleaned ${removed.length}/${candidates.length} old app backup(s)`);
  } else if (candidates.length > 0) {
    logger.warn(
      `[Updater] Could not remove any of ${candidates.length} old app backup(s); check permissions or quit other SClaw instances`,
    );
  }

  return removed;
}

const cleanupTimers: NodeJS.Timeout[] = [];

/** Run cleanup repeatedly while ShipIt may still be finishing the `.old-*` rename. */
export function scheduleOldAppBackupCleanup(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return;
  }

  for (const timer of cleanupTimers) {
    clearTimeout(timer);
  }
  cleanupTimers.length = 0;

  for (const delay of CLEANUP_RETRY_DELAYS_MS) {
    const timer = setTimeout(() => {
      void cleanupOldMacAppBackups(process.execPath);
    }, delay);
    cleanupTimers.push(timer);
  }

  logger.info(
    `[Updater] Scheduled old app backup cleanup at ${CLEANUP_RETRY_DELAYS_MS.map((ms) => `${ms / 1000}s`).join(', ')}`,
  );
}
