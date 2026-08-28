import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const root = process.cwd();
const packageRoot = join(root, 'packages', 'sclaw-plugin-sso-auth');
let packedFiles: string[] = [];

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { cwd: packageRoot, stdio: 'pipe' });
  const result = JSON.parse(execFileSync(
    'npm',
    ['pack', '--dry-run', '--json'],
    { cwd: packageRoot, encoding: 'utf8' },
  )) as Array<{ files?: Array<{ path?: string }> }>;
  packedFiles = (result[0]?.files ?? []).flatMap((file) => file.path ? [file.path] : []);
}, 30_000);

describe('SSO Auth npm package security contract', () => {
  it('ships runtime entries and SClaw metadata without development sources', () => {
    for (const required of [
      'dist/index.js',
      'dist/index.cjs',
      'dist/index.d.ts',
      'dist/index.d.cts',
      'dist/runtime.js',
      'dist/runtime.cjs',
      'dist/runtime.d.ts',
      'dist/runtime.d.cts',
      'dist/vite.js',
      'dist/vite.cjs',
      'dist/vite.d.ts',
      'dist/vite.d.cts',
      'sclaw/plugin.json',
      'sclaw/schemas/config.schema.json',
      'sclaw/skills/sso-auth/SKILL.md',
    ]) {
      expect(packedFiles, required).toContain(required);
    }
    expect(packedFiles.some((path) => path.startsWith('src/'))).toBe(false);
    expect(packedFiles.some((path) => path.startsWith('tests/'))).toBe(false);
    expect(packedFiles.some((path) => path.includes('.env'))).toBe(false);
  });

  it('keeps Manifest entrypoints inside the declared npm exports', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, 'sclaw', 'plugin.json'), 'utf8'),
    );
    expect(manifest.runtime.entry).toBe('./runtime');
    expect(pkg.exports).toHaveProperty(manifest.runtime.entry);
    expect(pkg.exports[manifest.runtime.entry]).toMatchObject({
      import: './dist/runtime.js',
      require: './dist/runtime.cjs',
      types: './dist/runtime.d.ts',
    });
  });

  it('limits Assets authentication to the local SClaw identity bridge', () => {
    const assetsRoot = join(root, 'resources', 'app-templates', 'assets-minimal');
    const pkg = JSON.parse(readFileSync(join(assetsRoot, 'package.json'), 'utf8'));
    const main = readFileSync(join(assetsRoot, 'src', 'main.tsx'), 'utf8');
    expect(pkg.dependencies).toMatchObject({ '@sto/sclaw-plugin-sso-auth': '0.1.0' });
    expect(main).toContain('bootstrapSsoAuth');
    expect(main).toContain("runtimeMode === 'local'");
    expect(main).not.toContain('buildSsoLoginUrl');
    expect(main).not.toContain('captureStoTokenFromUrl');
  });
});
