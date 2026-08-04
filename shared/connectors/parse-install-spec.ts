import { unwrapConnectorRuntime } from './normalize-runtime';
import type { ConnectorDownloadSource, ManagedCliInstallSpec } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const VALID_SOURCES = new Set<ConnectorDownloadSource>(['cdn', 'gitee', 'github']);
const VALID_STRATEGIES = new Set(['manifest_assets', 'shell_script', 'release_asset']);

function parseSourcePriority(raw: unknown): ConnectorDownloadSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter(
    (item): item is ConnectorDownloadSource =>
      typeof item === 'string' && VALID_SOURCES.has(item as ConnectorDownloadSource),
  );
  return items.length > 0 ? items : undefined;
}

function parsePostInstall(raw: unknown): string[][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const steps = raw
    .filter((item): item is string[] => Array.isArray(item))
    .map((item) => item.filter((part): part is string => typeof part === 'string'));
  return steps.length > 0 ? steps : undefined;
}

function parseStrategy(raw: unknown): ManagedCliInstallSpec['strategy'] {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!VALID_STRATEGIES.has(value)) return undefined;
  return value as ManagedCliInstallSpec['strategy'];
}

/** Parse `runtime.install` from connector catalog / admin JSON. */
export function parseManagedCliInstallSpec(
  runtime: Record<string, unknown> | undefined | null,
): ManagedCliInstallSpec {
  const root = unwrapConnectorRuntime(runtime ?? {});
  const install = asRecord(root.install);
  const ttl = install.manifestCacheTtlSec;
  return {
    strategy: parseStrategy(install.strategy),
    manifestUrl: text(install.manifestUrl) || undefined,
    fallbackManifestUrl: text(install.fallbackManifestUrl) || undefined,
    sourcePriority: parseSourcePriority(install.sourcePriority),
    manifestCacheTtlSec:
      typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0 ? ttl : undefined,
    unix: text(install.unix) || undefined,
    windows: text(install.windows) || undefined,
    binDir: text(install.binDir) || undefined,
    releaseApiUrl: text(install.releaseApiUrl) || undefined,
    assetNameHint: text(install.assetNameHint) || undefined,
    postInstall: parsePostInstall(install.postInstall),
  };
}
