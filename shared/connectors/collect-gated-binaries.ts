/**
 * Collect connector-gated CLI names from catalog descriptors (server-driven).
 * Kept free of heavier shared modules so OpenClaw plugin can vendor this file alone.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function unwrapRuntime(runtime: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(runtime.runtime);
  if (Object.keys(nested).length === 0) return runtime;
  return { ...runtime, ...nested, runtime: undefined };
}

function normalizeBinary(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/i, '');
}

/** Legacy defaults when catalog has not been synced yet. */
export const LEGACY_CONNECTOR_GATED_BINARIES = ['dws', 'glab', 'qpath', 'git'] as const;

export function collectGatedBinariesFromCatalog(
  descriptors: Array<{ runtime?: Record<string, unknown> | null }>,
): string[] {
  const set = new Set<string>();
  for (const descriptor of descriptors) {
    const runtime = unwrapRuntime(asRecord(descriptor.runtime));
    const gateway = asRecord(runtime.gateway);
    const primary = text(gateway.allowBinary) || text(runtime.binary);
    if (primary) set.add(normalizeBinary(primary));
    if (Array.isArray(gateway.allowBinaries)) {
      for (const item of gateway.allowBinaries) {
        const name = text(item);
        if (name) set.add(normalizeBinary(name));
      }
    }
  }
  return [...set].sort();
}

export function resolveGatedBinaries(
  catalogBinaries: string[] | null | undefined,
): string[] {
  if (catalogBinaries && catalogBinaries.length > 0) {
    return catalogBinaries.map(normalizeBinary).filter(Boolean);
  }
  return [...LEGACY_CONNECTOR_GATED_BINARIES];
}
