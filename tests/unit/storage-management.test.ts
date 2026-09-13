import { describe, expect, it } from 'vitest';
import {
  maxStorageSeverity,
  resolveDiskStorageSeverity,
  resolveManagedStorageSeverity,
  resolveStorageCleanupCutoff,
  shouldShowStorageReminder,
  STORAGE_BYTES,
} from '../../shared/storage-management';

describe('storage severity', () => {
  it('uses both disk percentage and absolute free-space thresholds', () => {
    expect(resolveDiskStorageSeverity(20 * STORAGE_BYTES.gib, 100 * STORAGE_BYTES.gib)).toBe('normal');
    expect(resolveDiskStorageSeverity(9 * STORAGE_BYTES.gib, 100 * STORAGE_BYTES.gib)).toBe('warning');
    expect(resolveDiskStorageSeverity(40 * STORAGE_BYTES.gib, 500 * STORAGE_BYTES.gib)).toBe('warning');
    expect(resolveDiskStorageSeverity(4 * STORAGE_BYTES.gib, 200 * STORAGE_BYTES.gib)).toBe('critical');
  });

  it('uses the configured managed-data thresholds', () => {
    expect(resolveManagedStorageSeverity(STORAGE_BYTES.managedWarning - 1)).toBe('normal');
    expect(resolveManagedStorageSeverity(STORAGE_BYTES.managedWarning)).toBe('warning');
    expect(resolveManagedStorageSeverity(STORAGE_BYTES.managedCritical)).toBe('critical');
  });

  it('returns the highest severity', () => {
    expect(maxStorageSeverity('normal', 'warning')).toBe('warning');
    expect(maxStorageSeverity('warning', 'critical')).toBe('critical');
  });

  it('shows at most once per local day and honors permanent disable', () => {
    const base = {
      todayLocalDate: '2026-09-12',
      diskSeverity: 'warning' as const,
      managedSeverity: 'normal' as const,
    };
    expect(shouldShowStorageReminder({ ...base, enabled: true, lastShownLocalDate: null })).toBe(true);
    expect(shouldShowStorageReminder({ ...base, enabled: true, lastShownLocalDate: '2026-09-12' })).toBe(false);
    expect(shouldShowStorageReminder({ ...base, enabled: false, lastShownLocalDate: null })).toBe(false);
    expect(shouldShowStorageReminder({ ...base, enabled: true, lastShownLocalDate: null, diskSeverity: 'normal' })).toBe(false);
  });

  it('uses the start of the local day for workspace retention cutoffs', () => {
    const cutoff = new Date(resolveStorageCleanupCutoff(new Date(2026, 8, 13, 18, 30), 7));
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(8);
    expect(cutoff.getDate()).toBe(6);
    expect(cutoff.getHours()).toBe(0);
    expect(cutoff.getMinutes()).toBe(0);
  });
});
