import { describe, expect, it } from 'vitest';
import {
  getMacAppBundleInfo,
  isOldAppBackupName,
} from '../../electron/utils/cleanup-old-app-bundles';

describe('cleanup-old-app-bundles', () => {
  it('parses macOS app bundle paths', () => {
    const execPath = '/Applications/STO Claw.app/Contents/MacOS/STO Claw';
    expect(getMacAppBundleInfo(execPath)).toEqual({
      installDir: '/Applications',
      bundleName: 'STO Claw.app',
      bundlePath: '/Applications/STO Claw.app',
    });
  });

  it('returns null for non-mac bundle paths', () => {
    expect(getMacAppBundleInfo('/usr/local/bin/foo')).toBeNull();
  });

  it('matches Squirrel .old backup names only', () => {
    const bundle = 'STO Claw.app';
    expect(isOldAppBackupName(bundle, 'STO Claw.app.old-1780371448851')).toBe(true);
    expect(isOldAppBackupName(bundle, 'STO Claw.app.old-999')).toBe(true);
    expect(isOldAppBackupName(bundle, 'STO Claw.app')).toBe(false);
    expect(isOldAppBackupName(bundle, 'STO Claw.app.old')).toBe(false);
    expect(isOldAppBackupName(bundle, 'Other.app.old-123')).toBe(false);
  });
});
