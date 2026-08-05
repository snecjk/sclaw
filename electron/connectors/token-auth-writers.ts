/**
 * Token-auth writers for managed_cli api_token mode (e.g. write PAT into glab config).
 * Prefer auth.login argv with placeholders when server provides them.
 */
import type { KindRuntimeConnectContext } from './runtimes/types';

export type TokenAuthWriter = (ctx: KindRuntimeConnectContext) => Promise<void>;

const writers = new Map<string, TokenAuthWriter>();

export function registerTokenAuthWriter(binary: string, writer: TokenAuthWriter): void {
  writers.set(binary.trim().toLowerCase().replace(/\.exe$/i, ''), writer);
}

export function getTokenAuthWriter(binary: string): TokenAuthWriter | undefined {
  return writers.get(binary.trim().toLowerCase().replace(/\.exe$/i, ''));
}

export function listTokenAuthWriterIds(): string[] {
  return [...writers.keys()].sort();
}
