import { posix } from 'node:path';

export type TemplateImportPathClass = 'protected' | 'ignored' | 'business';

const PROTECTED_EXACT = new Set([
  '.git',
  '.sclaw',
  'src/sclaw',
  'openspec/skills',
  '.gitignore',
  'manifest.json',
  'vite.config.ts',
  'vite.config.sclaw.ts',
  'scripts/dev-proxy.mjs',
  'scripts/ensure-dev-proxy.mjs',
  'scripts/sso-env.mjs',
  'contracts/external-services.v1.json',
  'contracts/dev-proxy.v1.json',
  'src/components/runtimebootstrapshell.tsx',
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

const SENSITIVE_FILE_NAMES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.ds_store',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
  'secrets.json',
]);

const SENSITIVE_FILE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.log'];

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
  const comparisonPath = path.toLowerCase();
  if (
    PROTECTED_EXACT.has(comparisonPath)
    || PROTECTED_PREFIXES.some((prefix) => comparisonPath.startsWith(prefix))
  ) {
    return 'protected';
  }
  const parts = comparisonPath.split('/');
  const base = parts.at(-1)?.toLowerCase() ?? '';
  if (
    (base.startsWith('.env') && base !== '.env.example')
    || SENSITIVE_FILE_NAMES.has(base)
    || SENSITIVE_FILE_SUFFIXES.some((suffix) => base.endsWith(suffix))
    || parts.some((part) => IGNORED_DIRS.has(part))
  ) {
    return 'ignored';
  }
  return 'business';
}
