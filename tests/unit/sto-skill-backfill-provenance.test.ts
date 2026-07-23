import { describe, expect, it } from 'vitest';
import {
  resolveBackfillManifestSource,
  shouldHealFalseMarketplaceProvenance,
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

  it('defaults to local when neither lock nor existing source is present', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: undefined,
        existingSource: undefined,
      }),
    ).toBe('local');
  });

  it('keeps existing non-protected source when lock is missing', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: undefined,
        existingSource: 'stoclaw-preinstalled',
      }),
    ).toBe('stoclaw-preinstalled');
  });

  it('uses lock source when present and existing is unprotected', () => {
    expect(
      resolveBackfillManifestSource({
        lockSource: 'sto-marketplace',
        existingSource: 'stoclaw-preinstalled',
      }),
    ).toBe('sto-marketplace');
  });

  it('heals marketplace labels that have no clawhub lock', () => {
    expect(
      shouldHealFalseMarketplaceProvenance({
        existingSource: 'sto-marketplace',
        lockSource: undefined,
      }),
    ).toBe(true);
    expect(
      shouldHealFalseMarketplaceProvenance({
        existingSource: 'sto-marketplace',
        lockSource: 'sto-marketplace',
      }),
    ).toBe(false);
    expect(
      shouldHealFalseMarketplaceProvenance({
        existingSource: 'local',
        lockSource: undefined,
      }),
    ).toBe(false);
  });
});
