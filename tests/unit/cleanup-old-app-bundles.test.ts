import { describe, expect, it } from 'vitest';
import {
  CLEANUP_RETRY_DELAYS_MS,
  getMacAppBundleInfo,
  isOldAppBackupName,
} from '../../electron/utils/cleanup-old-app-bundles';

describe('cleanup-old-app-bundles', () => {
  it('parses macOS app bundle paths', () => {
    const execPath = '/Applications/S Claw.app/Contents/MacOS/S Claw';
    expect(getMacAppBundleInfo(execPath)).toEqual({
      installDir: '/Applications',
      bundleName: 'S Claw.app',
      bundlePath: '/Applications/S Claw.app',
    });
  });

  it('returns null for non-mac bundle paths', () => {
    expect(getMacAppBundleInfo('/usr/local/bin/foo')).toBeNull();
  });

  it('matches Squirrel .old backup names only', () => {
    const bundle = 'S Claw.app';
    expect(isOldAppBackupName(bundle, 'S Claw.app.old-1780371448851')).toBe(true);
    expect(isOldAppBackupName(bundle, 'S Claw.app.old-999')).toBe(true);
    expect(isOldAppBackupName(bundle, 'S Claw.app')).toBe(false);
    expect(isOldAppBackupName(bundle, 'S Claw.app.old')).toBe(false);
    expect(isOldAppBackupName(bundle, 'Other.app.old-123')).toBe(false);
  });

  it('retries cleanup while ShipIt may still be renaming backups', () => {
    expect(CLEANUP_RETRY_DELAYS_MS).toEqual([0, 30_000, 120_000, 300_000]);
  });
});
