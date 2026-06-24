/**
 * Resolve `zod` through @anthropic-ai/claude-agent-sdk's peer dependency.
 * pnpm does not hoist `zod` to the repo root, so bare `import 'zod'` breaks Vite/Rollup.
 */
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);

const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk/package.json'));
const zodModule = require(require.resolve('zod', { paths: [sdkRoot] })) as typeof import('zod');

export const z = zodModule.z;
