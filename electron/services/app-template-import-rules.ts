import { posix } from 'node:path';

export type TemplateImportPathClass = 'protected' | 'ignored' | 'business';

const PROTECTED_EXACT = new Set([
  '.git',
  '.sclaw',
  'src/sclaw',
  'openspec/skills',
  'manifest.json',
  'vite.config.ts',
  'vite.config.sclaw.ts',
  'scripts/dev-proxy.mjs',
  'scripts/ensure-dev-proxy.mjs',
  'scripts/external-services.mjs',
  'scripts/sso-env.mjs',
  'contracts/external-services.v1.json',
  'contracts/dev-proxy.v1.json',
  'src/components/RuntimeBootstrapShell.tsx',
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
]);

const PROTECTED_PREFIXES = [
  '.git/',
  '.sclaw/',
  'src/sclaw/',
  'openspec/skills/',
];

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '.next',
]);

export function normalizeImportRelativePath(input: string): string {
  const slash = input.replaceAll('\\', '/');
  if (!slash || slash.startsWith('/') || /^[A-Za-z]:\//.test(slash)) {
    throw new Error(`非法导入路径: ${input}`);
  }
  const normalized = posix.normalize(slash);
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`非法导入路径: ${input}`);
  }
  return normalized;
}

export function classifyTemplateImportPath(input: string): TemplateImportPathClass {
  const path = normalizeImportRelativePath(input);
  if (
    PROTECTED_EXACT.has(path)
    || PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))
  ) {
    return 'protected';
  }
  const parts = path.split('/');
  const base = parts.at(-1)?.toLowerCase() ?? '';
  if (
    (base.startsWith('.env') && base !== '.env.example')
    || parts.some((part) => IGNORED_DIRS.has(part))
  ) {
    return 'ignored';
  }
  return 'business';
}
