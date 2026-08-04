/**
 * Resolve managed_cli install strategy from installSpec (+ optional legacy binary hint).
 * Prefer explicit `strategy` / install fields; fall back to binary name only for old catalogs.
 */
import type {
  ManagedCliInstallSpec,
  ManagedCliInstallStrategy,
} from './types';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function resolveManagedCliInstallStrategy(
  installSpec: ManagedCliInstallSpec,
  options?: { binary?: string },
): ManagedCliInstallStrategy {
  const explicit = installSpec.strategy;
  if (
    explicit === 'manifest_assets'
    || explicit === 'shell_script'
    || explicit === 'release_asset'
  ) {
    return explicit;
  }

  if (text(installSpec.unix) || text(installSpec.windows)) {
    return 'shell_script';
  }
  if (text(installSpec.releaseApiUrl)) {
    return 'release_asset';
  }
  if (text(installSpec.manifestUrl) || text(installSpec.fallbackManifestUrl)) {
    return 'manifest_assets';
  }

  // Legacy catalogs without strategy — infer from known binaries only.
  const binary = text(options?.binary).toLowerCase().replace(/\.exe$/i, '');
  if (binary === 'qpath') return 'shell_script';
  if (binary === 'glab') return 'release_asset';
  if (binary === 'dws') return 'manifest_assets';

  // Default: treat as manifest-driven so new connectors can rely on server:// alone.
  return 'manifest_assets';
}
