import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { importNativeEsm } from '../../../pi-runtime/native-esm-import';

type PiBrowserUseModule = typeof import('@amaster.ai/pi-browser-use');
type McpStdioModule = {
  DEFAULT_INHERITED_ENV_VARS: string[];
};

/**
 * chrome-devtools-mcp resolves to a path inside app.asar after packaging.
 * Electron's Node mode can execute that virtual path, while a standalone Node
 * runtime cannot. Preserve an explicit host override when one is configured.
 */
export function configurePiBrowserUseRuntime(
  env: NodeJS.ProcessEnv = process.env,
  execPath = process.execPath,
  inheritedEnvVars: string[] = [],
): void {
  if (env.PI_BROWSER_USE_NODE?.trim()) return;
  env.PI_BROWSER_USE_NODE = execPath;
  env.ELECTRON_RUN_AS_NODE = '1';
  if (!inheritedEnvVars.includes('ELECTRON_RUN_AS_NODE')) {
    inheritedEnvVars.push('ELECTRON_RUN_AS_NODE');
  }
}

/**
 * Explicitly load the reviewed Pi extension while project/package extension
 * discovery remains disabled.
 */
export async function buildPiBrowserUseExtension(): Promise<InlineExtension> {
  // MCP's stdio transport inherits only an explicit environment allowlist.
  // Include Electron's Node-mode switch so spawning process.execPath executes
  // the MCP entrypoint instead of starting a second SClaw application instance.
  const { DEFAULT_INHERITED_ENV_VARS } = await importNativeEsm<McpStdioModule>(
    '@modelcontextprotocol/sdk/client/stdio.js',
  );
  configurePiBrowserUseRuntime(
    process.env,
    process.execPath,
    DEFAULT_INHERITED_ENV_VARS,
  );

  // Import only after the worker has scoped Pi's extension settings and data
  // directories. The package computes its default profile during module load.
  const { default: browserUseExtension } = await importNativeEsm<PiBrowserUseModule>(
    '@amaster.ai/pi-browser-use',
  );
  return {
    name: 'pi-browser-use',
    factory(pi) {
      browserUseExtension(pi);
    },
  };
}
