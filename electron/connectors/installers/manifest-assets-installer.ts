/**
 * manifest_assets installer — fetch installManifest and install platform assets.
 * Implementation currently reuses the shared CLI download pipeline in dws-cli
 * (binary/skill install under ~/.stoclaw), but the public API is strategy-named.
 */
import type { ManagedCliInstallSpec } from '../../../shared/connectors/types';
import { installOrUpdateDwsCli } from '../../utils/dws-cli';

export interface ManifestAssetsInstallOptions {
  installSpec: ManagedCliInstallSpec;
  connectorId?: string;
  /** Skill cache slug; defaults to binary name. */
  skillSlug?: string;
  binary?: string;
  onProgress?: (message: string) => void;
}

export interface ManifestAssetsInstallResult {
  success: boolean;
  path?: string;
  version?: string;
  updated?: boolean;
  error?: string;
}

export async function installViaManifestAssets(
  options: ManifestAssetsInstallOptions,
): Promise<ManifestAssetsInstallResult> {
  const binary = options.binary?.trim().replace(/\.exe$/i, '') || '';
  const skillSlug =
    options.skillSlug?.trim()
    || (binary === 'dws' ? 'dws' : binary || 'cli');

  return installOrUpdateDwsCli({
    installSpec: options.installSpec,
    connectorId: options.connectorId,
    skillSlug,
    binary: binary || undefined,
    onProgress: options.onProgress,
  });
}
