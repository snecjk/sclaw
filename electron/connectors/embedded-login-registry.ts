/**
 * Embedded login adapter registry — select by auth.adapter or binary name.
 */
import type { BrowserWindow } from 'electron';

import type { KindRuntimeConnectContext, KindRuntimeStatusResult } from './runtimes/types';

export type EmbeddedLoginAdapter = {
  id: string;
  authorize: (ctx: {
    parentWindow?: BrowserWindow | null;
    onProgress?: KindRuntimeConnectContext['onProgress'];
  }) => Promise<void>;
  /**
   * Optional: interpret auth.status stdout/stderr when exit code alone is not enough
   * (e.g. qpath status exits 0 but body says 未登录).
   */
  isAuthenticatedFromOutput?: (output: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }) => boolean;
  /** Optional: richer install probe when binDir resolve misses. */
  probeInstalled?: () => Promise<{
    installed: boolean;
    version?: string | null;
  }>;
};

const adapters = new Map<string, EmbeddedLoginAdapter>();

export function registerEmbeddedLoginAdapter(adapter: EmbeddedLoginAdapter): void {
  adapters.set(adapter.id.trim().toLowerCase(), adapter);
}

export function getEmbeddedLoginAdapter(id: string): EmbeddedLoginAdapter | undefined {
  return adapters.get(id.trim().toLowerCase());
}

export function listEmbeddedLoginAdapterIds(): string[] {
  return [...adapters.keys()].sort();
}

/** Resolve adapter id from auth.adapter or binary. */
export function resolveEmbeddedAdapterId(options: {
  binary: string;
  adapter?: string;
}): string {
  const fromAuth = options.adapter?.trim().toLowerCase().replace(/\.exe$/i, '');
  if (fromAuth) return fromAuth;
  return options.binary.trim().toLowerCase().replace(/\.exe$/i, '');
}

export function interpretAuthStatusOutput(
  adapterId: string | undefined,
  output: { stdout: string; stderr: string; exitCode: number },
): boolean | null {
  if (!adapterId) return null;
  const adapter = getEmbeddedLoginAdapter(adapterId);
  if (!adapter?.isAuthenticatedFromOutput) return null;
  return adapter.isAuthenticatedFromOutput(output);
}

export async function probeInstalledViaAdapter(
  adapterId: string | undefined,
): Promise<KindRuntimeStatusResult | null> {
  if (!adapterId) return null;
  const adapter = getEmbeddedLoginAdapter(adapterId);
  if (!adapter?.probeInstalled) return null;
  const result = await adapter.probeInstalled();
  if (!result.installed) {
    return { status: 'available', installedVersion: null, authenticated: false };
  }
  return {
    status: 'installed',
    installedVersion: result.version ?? null,
    authenticated: false,
  };
}
