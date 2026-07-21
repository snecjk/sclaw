import { describe, expect, it } from 'vitest';
import {
  resolveBackfillManifestSource,
  shouldPreserveManifestProvenance,
} from '../../electron/services/sto-skill-service';

describe('backfillLockVersions provenance guards', () => {
  it('preserves local and user-upload sources', () => {
    expect(shouldPreserveManifestProvenance('local')).toBe(true);
    expect(shouldPreserveManifestProvenance('user-upload')).toBe(true);
    expect(shouldPreserveManifestProvenance('sto-marketplace')).toBe(false);
    expect(shouldPreserveManifestProvenance('stoclaw-preinstalled')).toBe(false);
    expect(shouldPreserveManifestProvenance(undefined)).toBe(false);
  });

  it('does not default missing lock to marketplace when existing is local', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: undefined,
        existingSource: 'local',
      }),
    ).toBe('local');
  });

  it('keeps user-upload even when lock claims marketplace', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: 'sto-marketplace',
        existingSource: 'user-upload',
      }),
    ).toBe('user-upload');
  });

  it('falls back to marketplace only when provenance is unprotected', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: undefined,
        existingSource: undefined,
      }),
    ).toBe('sto-marketplace');
    expect(
      resolveBackfillManifestSource({
        lockSource: 'sto-marketplace',
        existingSource: 'stoclaw-preinstalled',
      }),
    ).toBe('sto-marketplace');
  });
});
