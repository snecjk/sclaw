/**
 * Squirrel.Mac (electron-updater on macOS) renames the existing .app bundle to
 * `{Name}.app.old-{timestamp}` during in-place updates. ShipIt should delete it
 * after a successful swap, but the backup is often left behind in /Applications.
 */
import { app } from 'electron';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { logger } from './logger';

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

/** True for Squirrel backup names like `STO Claw.app.old-1780371448851`. */
export function isOldAppBackupName(bundleName: string, entryName: string): boolean {
  const pattern = new RegExp(`^${escapeRegExp(bundleName)}\\.old-\\d+$`);
  return pattern.test(entryName);
}

/** Remove all sibling `.app.old-*` backups next to the running app bundle. */
export async function cleanupOldMacAppBackups(execPath: string): Promise<string[]> {
  const info = getMacAppBundleInfo(execPath);
  if (!info) {
    return [];
  }

  let entries: string[];
  try {
    entries = await readdir(info.installDir);
  } catch (error) {
    logger.warn('[Updater] Could not read install directory for old backup cleanup:', error);
    return [];
  }

  const removed: string[] = [];
  for (const name of entries) {
    if (!isOldAppBackupName(info.bundleName, name)) {
      continue;
    }

    const target = join(info.installDir, name);
    if (resolve(target) === resolve(info.bundlePath)) {
      continue;
    }

    try {
      const st = await stat(target);
      if (!st.isDirectory()) {
        continue;
      }
      await rm(target, { recursive: true, force: true });
      removed.push(target);
      logger.info(`[Updater] Removed old app backup: ${target}`);
    } catch (error) {
      logger.warn(`[Updater] Failed to remove old app backup ${target}:`, error);
    }
  }

  return removed;
}

/** Run cleanup now and once more after a short delay (ShipIt may still be finishing). */
export function scheduleOldAppBackupCleanup(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return;
  }

  const run = (): void => {
    void cleanupOldMacAppBackups(process.execPath);
  };

  run();
  setTimeout(run, 30_000);
}
