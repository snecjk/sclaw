import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { importNativeEsm } from '../../../pi-runtime/native-esm-import';

type PiMemoryModule = typeof import('pi-memory');
type PiMemoryModuleLoader = (specifier: string) => Promise<PiMemoryModule>;

export const PI_MEMORY_TOOL_NAMES = [
  'memory_write',
  'memory_forget',
  'memory_restore',
  'memory_read',
  'scratchpad',
  'memory_search',
  'memory_status',
] as const;

/**
 * Keep pi-memory inside SClaw's managed Pi directory. Phase one deliberately
 * leaves qmd background indexing and model-generated exit summaries disabled.
 * Explicit host configuration always wins.
 */
export function configurePiMemoryRuntime(env: NodeJS.ProcessEnv = process.env): void {
  const agentDir = env.PI_AGENT_HOME?.trim() || env.PI_CODING_AGENT_DIR?.trim();
  if (!env.PI_MEMORY_DIR?.trim() && agentDir) {
    env.PI_MEMORY_DIR = join(agentDir, 'memory');
  }
  if (!env.PI_MEMORY_SNAPSHOT?.trim()) env.PI_MEMORY_SNAPSHOT = 'stable';
  if (!env.PI_MEMORY_QMD_UPDATE?.trim()) env.PI_MEMORY_QMD_UPDATE = 'off';
  if (!env.PI_MEMORY_EXIT_SUMMARY?.trim()) env.PI_MEMORY_EXIT_SUMMARY = '0';
}

/**
 * Load the separately bundled ESM runtime. The Pi worker itself is CommonJS;
 * bundling pi-memory into it would rewrite the package's ESM-only Pi SDK
 * imports to require() and fail with ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
export async function loadPiMemoryExtension(
  loadModule: PiMemoryModuleLoader,
  runtimeDir: string,
): Promise<InlineExtension> {
  configurePiMemoryRuntime();
  const moduleUrl = pathToFileURL(join(runtimeDir, 'pi-memory.mjs')).href;
  const { default: memoryExtension } = await loadModule(moduleUrl);
  return {
    name: 'pi-memory',
    factory(pi) {
      memoryExtension(pi);
    },
  };
}

/** Explicitly load the reviewed extension while package discovery stays off. */
export async function buildPiMemoryExtension(): Promise<InlineExtension> {
  return loadPiMemoryExtension(
    (specifier) => importNativeEsm<PiMemoryModule>(specifier),
    __dirname,
  );
}
