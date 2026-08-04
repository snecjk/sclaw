import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLEANUP_RETRY_DELAYS_MS,
  getMacAppBundleInfo,
  getStaleMacAppTargetPath,
  isOldAppBackupName,
  isStaleAppTargetName,
  resolveMacAppInstallTargetPath,
  stageExistingMacAppTarget,
} from '../../electron/utils/cleanup-old-app-bundles';

describe('cleanup-old-app-bundles', () => {
  it('parses macOS app bundle paths', () => {
    const execPath = '/Applications/SClaw.app/Contents/MacOS/SClaw';
    expect(getMacAppBundleInfo(execPath)).toEqual({
      installDir: '/Applications',
      bundleName: 'SClaw.app',
      bundlePath: '/Applications/SClaw.app',
    });
  });

  it('returns null for non-mac bundle paths', () => {
    expect(getMacAppBundleInfo('/usr/local/bin/foo')).toBeNull();
  });

  it('matches Squirrel .old backup names only', () => {
    const bundle = 'SClaw.app';
    expect(isOldAppBackupName(bundle, 'SClaw.app.old-1780371448851')).toBe(true);
    expect(isOldAppBackupName(bundle, 'SClaw.app.old-999')).toBe(true);
    expect(isOldAppBackupName(bundle, 'SClaw.app')).toBe(false);
    expect(isOldAppBackupName(bundle, 'SClaw.app.old')).toBe(false);
    expect(isOldAppBackupName(bundle, 'Other.app.old-123')).toBe(false);
  });

  it('matches updater-staged stale target names only', () => {
    const bundle = 'SClaw.app';
    expect(isStaleAppTargetName(bundle, 'SClaw.app.stale-1780371448851')).toBe(true);
    expect(isStaleAppTargetName(bundle, 'SClaw.app.stale-1780371448851-1')).toBe(true);
    expect(isStaleAppTargetName(bundle, 'SClaw.app')).toBe(false);
    expect(isStaleAppTargetName(bundle, 'SClaw.app.stale')).toBe(false);
    expect(isStaleAppTargetName(bundle, 'Other.app.stale-123')).toBe(false);
  });

  it('normalizes legacy extracted app names to the renamed install target', () => {
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/S Claw.app')).toBe('/Applications/SClaw.app');
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/SClaw.app')).toBe('/Applications/SClaw.app');
  });

  it('stages an existing renamed install target without deleting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stoclaw-cleanup-test-'));
    try {
      const currentAppPath = join(root, 'S Claw.app');
      const targetAppPath = join(root, 'SClaw.app');
      const targetResourcePath = join(targetAppPath, 'Contents', 'Resources', 'marker.txt');

      await mkdir(currentAppPath, { recursive: true });
      await mkdir(join(targetAppPath, 'Contents', 'Resources'), { recursive: true });
      await writeFile(join(currentAppPath, 'marker.txt'), 'current');
      await writeFile(targetResourcePath, 'stale');

      const stagedPath = await stageExistingMacAppTarget(currentAppPath, targetAppPath, 1780371448851);

      expect(stagedPath).toBe(getStaleMacAppTargetPath(targetAppPath, 1780371448851));
      await expect(stat(targetAppPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stat(join(stagedPath!, 'Contents', 'Resources', 'marker.txt'))).resolves.toBeTruthy();
      await expect(stat(currentAppPath)).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retries cleanup while ShipIt may still be renaming backups', () => {
    expect(CLEANUP_RETRY_DELAYS_MS).toEqual([0, 30_000, 120_000, 300_000]);
  });
});
