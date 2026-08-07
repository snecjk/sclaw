import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLEANUP_RETRY_DELAYS_MS,
  compareMacAppVersions,
  getMacAppBundleInfo,
  getStaleMacAppTargetPath,
  isLegacyMacAppBundleName,
  isKnownOldAppBackupName,
  isOldAppBackupName,
  isSafeMacAppBackupPath,
  isStaleAppTargetName,
  MAC_LAUNCH_SERVICES_TIMEOUT_MS,
  registerMacAppBundle,
  resolveMacAppInstallTargetPath,
  shouldPreserveCanonicalMacApp,
  stageExistingMacAppTarget,
  unregisterMacAppBundle,
} from '../../electron/utils/cleanup-old-app-bundles';

async function createMacAppBundle(
  root: string,
  name: string,
  version: string,
  includeExecutable = true,
): Promise<string> {
  const appPath = join(root, name);
  const macosPath = join(appPath, 'Contents', 'MacOS');
  await mkdir(macosPath, { recursive: true });
  await writeFile(
    join(appPath, 'Contents', 'Info.plist'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist><dict>',
      '<key>CFBundleExecutable</key><string>SClaw</string>',
      `<key>CFBundleShortVersionString</key><string>${version}</string>`,
      '</dict></plist>',
    ].join(''),
  );
  if (includeExecutable) {
    await writeFile(join(macosPath, 'SClaw'), '');
  }
  return appPath;
}

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

  it('matches backups from every historical macOS bundle name', () => {
    expect(isKnownOldAppBackupName('SClaw.app', 'StoClaw.app.old-1785859923820')).toBe(true);
    expect(isKnownOldAppBackupName('SClaw.app', 'STO Claw.app.old-1785859923820')).toBe(true);
    expect(isKnownOldAppBackupName('SClaw.app', 'S Claw.app.old-1785859923820')).toBe(true);
    expect(isKnownOldAppBackupName('SClaw.app', 'SClaw.app.old-1785859923820')).toBe(true);
    expect(isKnownOldAppBackupName('S Claw.app', 'SClaw.app.old-1785859923820')).toBe(true);
    expect(isKnownOldAppBackupName('SClaw.app', 'Other.app.old-1785859923820')).toBe(false);
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
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/StoClaw.app')).toBe('/Applications/SClaw.app');
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/STO Claw.app')).toBe('/Applications/SClaw.app');
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/S Claw.app')).toBe('/Applications/SClaw.app');
    expect(resolveMacAppInstallTargetPath('/Applications', '/tmp/update/SClaw.app')).toBe('/Applications/SClaw.app');
  });

  it('recognizes only shipped historical bundle names as legacy', () => {
    expect(isLegacyMacAppBundleName('StoClaw.app')).toBe(true);
    expect(isLegacyMacAppBundleName('STO Claw.app')).toBe(true);
    expect(isLegacyMacAppBundleName('S Claw.app')).toBe(true);
    expect(isLegacyMacAppBundleName('SClaw.app')).toBe(false);
  });

  it('uses targeted Launch Services commands for app bundles', async () => {
    const exec = vi.fn(async () => undefined);

    await expect(unregisterMacAppBundle('/Applications/STO Claw.app', {
      platform: 'darwin',
      exec,
    })).resolves.toBe(true);
    await expect(registerMacAppBundle('/Applications/SClaw.app', {
      platform: 'darwin',
      exec,
    })).resolves.toBe(true);

    const tool = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    const options = {
      timeout: MAC_LAUNCH_SERVICES_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    };
    expect(exec).toHaveBeenNthCalledWith(1, tool, ['-u', '/Applications/STO Claw.app'], options);
    expect(exec).toHaveBeenNthCalledWith(2, tool, ['-f', '/Applications/SClaw.app'], options);
  });

  it('continues when targeted Launch Services reconciliation fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('lsregister unavailable');
    });

    await expect(registerMacAppBundle('/Applications/SClaw.app', {
      platform: 'darwin',
      exec,
    })).resolves.toBe(false);
  });

  it('compares numeric app release versions', () => {
    expect(compareMacAppVersions('2026.8.4-GA.3', '2026.8.4-GA.2')).toBe(1);
    expect(compareMacAppVersions('2026.8.4-GA.3', '2026.8.4-GA.3')).toBe(0);
    expect(compareMacAppVersions('2026.7.27-GA.1', '2026.8.4-GA.1')).toBe(-1);
    expect(compareMacAppVersions('unknown', '2026.8.4-GA.1')).toBeNull();
  });

  it('preserves an equal or newer valid canonical app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stoclaw-coexist-test-'));
    try {
      const historical = await createMacAppBundle(root, 'STO Claw.app', '2026.8.4-GA.2');
      const canonical = await createMacAppBundle(root, 'SClaw.app', '2026.8.4-GA.3');

      await expect(shouldPreserveCanonicalMacApp(historical, canonical)).resolves.toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('replaces an older or incomplete canonical app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'stoclaw-coexist-test-'));
    try {
      const historical = await createMacAppBundle(root, 'STO Claw.app', '2026.8.4-GA.3');
      const olderCanonical = await createMacAppBundle(root, 'SClaw.app', '2026.8.4-GA.2');
      await expect(shouldPreserveCanonicalMacApp(historical, olderCanonical)).resolves.toBe(false);

      await rm(olderCanonical, { recursive: true, force: true });
      const incompleteCanonical = await createMacAppBundle(root, 'SClaw.app', '2026.8.4-GA.4', false);
      await expect(shouldPreserveCanonicalMacApp(historical, incompleteCanonical)).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts only updater backup markers beside the current app', () => {
    const current = '/Applications/SClaw.app';
    expect(isSafeMacAppBackupPath(current, '/Applications/STO Claw.app.old-1785859923820')).toBe(true);
    expect(isSafeMacAppBackupPath(current, '/tmp/SClaw.app.old-1785859923820')).toBe(false);
    expect(isSafeMacAppBackupPath(current, '/Applications/Other.app.old-1785859923820')).toBe(false);
    expect(isSafeMacAppBackupPath(current, '/Applications/SClaw.app.stale-1785859923820')).toBe(false);
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
