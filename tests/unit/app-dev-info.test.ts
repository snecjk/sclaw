import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  creepRatio,
  isTemplateTextFile,
  isTransientNpmInstallFailure,
  needsAppNpmInstall,
  parseNpmrcRegistry,
  pipelineProgress,
  sanitizePackageName,
  stripInheritedNpmRegistryEnv,
  substituteTemplateVars,
  buildSnpmInstallArgs,
  lastInstallLogLine,
  pushInstallLogTail,
  stripInstallLogAnsi,
} from '../../electron/utils/app-dev-info';

describe('app-dev-info', () => {
  describe('pipelineProgress（连续单进度条映射）', () => {
    it('maps phases onto non-overlapping ascending ranges', () => {
      expect(pipelineProgress('created', 0)).toBe(0);
      expect(pipelineProgress('preparing-env', 0)).toBe(0);
      expect(pipelineProgress('preparing-env', 1)).toBe(18);
      expect(pipelineProgress('checking-snpm', 0)).toBe(18);
      expect(pipelineProgress('checking-snpm', 1)).toBe(32);
      expect(pipelineProgress('installing', 0)).toBe(32);
      expect(pipelineProgress('installing', 1)).toBe(80);
      expect(pipelineProgress('starting', 0)).toBe(80);
      expect(pipelineProgress('starting', 1)).toBe(99);
      expect(pipelineProgress('ready', 0)).toBe(100);
    });

    it('clamps out-of-range ratios', () => {
      expect(pipelineProgress('installing', -1)).toBe(32);
      expect(pipelineProgress('installing', 2)).toBe(80);
    });
  });

  describe('sanitizePackageName', () => {
    it('converts Chinese/mixed names to a safe fallback or kebab-case', () => {
      expect(sanitizePackageName('快递查询')).toBe('sclaw-app');
      expect(sanitizePackageName('My Cool App!')).toBe('my-cool-app');
      expect(sanitizePackageName('  Order-Center 2 ')).toBe('order-center-2');
    });
  });

  describe('isTemplateTextFile', () => {
    it('treats source/config/doc files and dotfiles as text', () => {
      for (const f of ['a.tsx', 'b.json', 'index.html', '.npmrc', '.gitignore', 'x.css', 'y.md']) {
        expect(isTemplateTextFile(f), f).toBe(true);
      }
    });

    it('treats binaries as non-text', () => {
      expect(isTemplateTextFile('logo.png')).toBe(false);
      expect(isTemplateTextFile('font.woff2')).toBe(false);
    });
  });

  it('substituteTemplateVars replaces every occurrence of both vars', () => {
    const out = substituteTemplateVars('{"name":"__APP_NAME__","title":"__APP_TITLE__ / __APP_TITLE__"}', {
      appName: 'my-app',
      appTitle: '我的应用',
    });
    expect(out).toBe('{"name":"my-app","title":"我的应用 / 我的应用"}');
  });

  it('creepRatio approaches but never reaches 1', () => {
    let r = 0;
    for (let i = 0; i < 500; i++) r = creepRatio(r);
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThanOrEqual(0.98);
  });

  describe('needsAppNpmInstall', () => {
    const dirs: string[] = [];

    afterEach(async () => {
      await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    });

    async function tmpRoot(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'app-npm-install-'));
      dirs.push(dir);
      return dir;
    }

    it('needs install when node_modules is missing', async () => {
      expect(needsAppNpmInstall(await tmpRoot())).toBe(true);
    });

    it('needs install when node_modules is empty or only bookkeeping', async () => {
      const empty = await tmpRoot();
      await mkdir(join(empty, 'node_modules'));
      expect(needsAppNpmInstall(empty)).toBe(true);

      const bookkeeping = await tmpRoot();
      await mkdir(join(bookkeeping, 'node_modules', '.bin'), { recursive: true });
      await writeFile(join(bookkeeping, 'node_modules', '.package-lock.json'), '{}');
      expect(needsAppNpmInstall(bookkeeping)).toBe(true);
    });

    it('needs install when a scoped folder has no package.json', async () => {
      const root = await tmpRoot();
      await mkdir(join(root, 'node_modules', '@sto'), { recursive: true });
      expect(needsAppNpmInstall(root)).toBe(true);
    });

    it('skips install when a package is present', async () => {
      const root = await tmpRoot();
      await mkdir(join(root, 'node_modules', 'vite'), { recursive: true });
      await writeFile(join(root, 'node_modules', 'vite', 'package.json'), '{"name":"vite"}');
      expect(needsAppNpmInstall(root)).toBe(false);
    });

    it('skips install when a scoped package is present', async () => {
      const root = await tmpRoot();
      await mkdir(join(root, 'node_modules', '@vitejs', 'plugin-react'), { recursive: true });
      await writeFile(
        join(root, 'node_modules', '@vitejs', 'plugin-react', 'package.json'),
        '{"name":"@vitejs/plugin-react"}',
      );
      expect(needsAppNpmInstall(root)).toBe(false);
    });

    it('needs install when a declared direct dependency is missing', async () => {
      const root = await tmpRoot();
      await writeFile(join(root, 'package.json'), JSON.stringify({
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^5.4.0', '@vitejs/plugin-react': '^4.7.0' },
      }));
      await mkdir(join(root, 'node_modules', 'vite'), { recursive: true });
      await writeFile(join(root, 'node_modules', 'vite', 'package.json'), '{"name":"vite"}');

      expect(needsAppNpmInstall(root)).toBe(true);
    });
  });

  it('stripInheritedNpmRegistryEnv drops host registry overrides', () => {
    const next = stripInheritedNpmRegistryEnv({
      PATH: '/bin',
      npm_config_registry: 'https://r.cnpmjs.org',
      NPM_CONFIG_REGISTRY: 'https://r.cnpmjs.org',
      'npm_config_@sto:registry': 'https://r.cnpmjs.org',
      npm_config_cache: '/tmp/cache',
    });
    expect(next.PATH).toBe('/bin');
    expect(next.npm_config_cache).toBe('/tmp/cache');
    expect(next.npm_config_registry).toBeUndefined();
    expect(next.NPM_CONFIG_REGISTRY).toBeUndefined();
    expect(next['npm_config_@sto:registry']).toBeUndefined();
  });

  it('parseNpmrcRegistry reads the project registry line', () => {
    expect(parseNpmrcRegistry('# comment\nregistry=http://snpm-registry.sto.cn\n')).toBe(
      'http://snpm-registry.sto.cn',
    );
    expect(parseNpmrcRegistry('shamefully-hoist=true\n')).toBeUndefined();
  });

  it('buildSnpmInstallArgs uses snpm install (and --save for packages)', () => {
    expect(buildSnpmInstallArgs('http://snpm-registry.sto.cn')).toEqual([
      'install',
      '--registry=http://snpm-registry.sto.cn',
    ]);
    expect(buildSnpmInstallArgs(undefined, ['antd'])).toEqual([
      'install',
      'antd',
      '--save',
    ]);
  });

  it('isTransientNpmInstallFailure matches cnpm TLS resets', () => {
    expect(
      isTransientNpmInstallFailure(
        'npm error code ECONNRESET\nrequest to https://r.cnpmjs.org/@sto%2fsclaw-plugin-sso-auth failed, reason: Client network socket disconnected before secure TLS connection was established',
      ),
    ).toBe(true);
    expect(isTransientNpmInstallFailure('npm error code E404')).toBe(false);
  });

  it('keeps a readable snpm log tail for the workbench', () => {
    expect(stripInstallLogAnsi('\u001B[32mhttp fetch\u001B[0m GET lodash')).toBe('http fetch GET lodash');
    expect(pushInstallLogTail('line-1\n', 'line-2\rline-3\n')).toBe('line-1\nline-2\nline-3');
    expect(lastInstallLogLine('a\n  b  \n')).toBe('b');
    const many = Array.from({ length: 80 }, (_, i) => `pkg ${i}`).join('\n');
    const tail = pushInstallLogTail('', many, 8, 2000);
    expect(tail.split('\n')).toEqual(['pkg 72', 'pkg 73', 'pkg 74', 'pkg 75', 'pkg 76', 'pkg 77', 'pkg 78', 'pkg 79']);
  });
});
