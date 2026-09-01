import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { importNativeEsm } from '../../../pi-runtime/native-esm-import';

type PiBrowserUseModule = typeof import('@amaster.ai/pi-browser-use');

type BrowserNodeRuntimeOptions = {
  platform?: NodeJS.Platform;
  arch?: string;
  cwd?: string;
  resourcesPath?: string;
  path?: string;
  exists?: (path: string) => boolean;
};

/**
 * chrome-devtools-mcp is a Node CLI. On Windows, launching it through the
 * Electron application executable can emit non-MCP output on stdout, which
 * the MCP transport then reports as a SyntaxError. Prefer a real node.exe.
 */
export function resolvePiBrowserNodeRuntime(
  options: BrowserNodeRuntimeOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return undefined;

  const exists = options.exists ?? existsSync;
  const arch = options.arch ?? process.arch;
  const cwd = options.cwd ?? process.cwd();
  const resourcesPath = options.resourcesPath
    ?? (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resourcesPath ? join(resourcesPath, 'bin', 'node.exe') : undefined,
    join(cwd, 'resources', 'bin', `win32-${arch}`, 'node.exe'),
    ...(options.path ?? process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((entry) => join(entry.replace(/^"|"$/g, ''), 'node.exe')),
  ];

  return candidates.find((candidate): candidate is string => Boolean(candidate && exists(candidate)));
}

/**
 * Explicitly load the reviewed Pi extension while project/package extension
 * discovery remains disabled.
 */
export async function buildPiBrowserUseExtension(): Promise<InlineExtension> {
  // Import only after the worker has scoped Pi's extension settings and data
  // directories. The package computes its default profile during module load.
  const { default: browserUseExtension } = await importNativeEsm<PiBrowserUseModule>(
    '@amaster.ai/pi-browser-use',
  );
  return {
    name: 'pi-browser-use',
    factory(pi) {
      if (!process.env.PI_BROWSER_USE_NODE?.trim()) {
        const nodeRuntime = resolvePiBrowserNodeRuntime();
        process.env.PI_BROWSER_USE_NODE = nodeRuntime ?? process.execPath;
        if (!nodeRuntime) process.env.ELECTRON_RUN_AS_NODE = '1';
      }
      browserUseExtension(pi);
    },
  };
}
