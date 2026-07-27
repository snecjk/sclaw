import { describe, expect, it } from 'vitest';
import {
  CLEANUP_RETRY_DELAYS_MS,
  getMacAppBundleInfo,
  isOldAppBackupName,
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

  it('retries cleanup while ShipIt may still be renaming backups', () => {
    expect(CLEANUP_RETRY_DELAYS_MS).toEqual([0, 30_000, 120_000, 300_000]);
  });
});
