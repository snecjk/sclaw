import { describe, expect, it } from 'vitest';

import {
  createManagedSourceEntry,
  createManagedViteFiles,
  mergeTemplatePackageJson,
} from '../../electron/services/app-template-import-adapter';

describe('app template import adapter', () => {
  it('来源依赖优先但保留平台脚本、受管包和 rollup 约束', () => {
    const result = mergeTemplatePackageJson({
      platform: {
        scripts: {
          dev: 'vite',
          build: 'vite build',
          'sclaw:services': 'node scripts/external-services.mjs',
        },
        dependencies: {
          '@sto/sclaw-plugin-sso-auth': '0.1.0',
          react: '^19.0.0',
        },
        devDependencies: { vite: '^5.4.0' },
        resolutions: { rollup: '4.62.2' },
        overrides: { rollup: '4.62.2' },
      },
      source: {
        scripts: { dev: 'vite --host 0.0.0.0', build: 'custom-build', lint: 'eslint .' },
        dependencies: {
          '@sto/sclaw-plugin-sso-auth': '9.0.0',
          react: '^18.0.0',
          dayjs: '^1.11.0',
        },
        devDependencies: { vite: '^5.4.10' },
      },
      managedPackages: ['@sto/sclaw-plugin-sso-auth'],
    });

    expect(result.packageJson).toMatchObject({
      private: true,
      scripts: {
        dev: 'vite',
        build: 'vite build',
        lint: 'eslint .',
        'sclaw:services': 'node scripts/external-services.mjs',
      },
      dependencies: {
        '@sto/sclaw-plugin-sso-auth': '0.1.0',
        react: '^18.0.0',
        dayjs: '^1.11.0',
      },
      devDependencies: { vite: '^5.4.10' },
      resolutions: { rollup: '4.62.2' },
      overrides: { rollup: '4.62.2' },
    });
    expect(result.changes).toContainEqual(expect.objectContaining({
      name: '@sto/sclaw-plugin-sso-auth',
      section: 'dependencies',
      sourceValue: '9.0.0',
      appliedValue: '0.1.0',
      resolution: 'platform',
    }));
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'DEPENDENCY_CONFLICT',
      path: 'dependencies.@sto/sclaw-plugin-sso-auth',
    }));
  });

  it('来源 Vite 配置是 defaults，平台配置是 overrides', () => {
    const files = createManagedViteFiles({ sourceExtension: 'ts' });
    expect(files['vite.config.ts']).toContain(
      'mergeConfig(source?.config ?? {}, platform?.config ?? {})',
    );
    expect(files['vite.config.ts']).toContain("'vite.config.source.ts'");
    expect(files['vite.config.ts']).toContain("'vite.config.sclaw.ts'");
  });

  it('没有来源 Vite 配置时只加载平台配置', () => {
    const files = createManagedViteFiles({});
    expect(files['vite.config.ts']).toContain('const source = null;');
    expect(files['vite.config.ts']).toContain('platform?.config ?? {}');
  });

  it('Site 先启动插件再加载来源入口', () => {
    const source = createManagedSourceEntry({
      pageType: 'site',
      sourceEntry: 'src/main.source.tsx',
    });
    expect(source.indexOf('await bootstrapInstalledPlugins()')).toBeLessThan(
      source.indexOf("await import('./main.source')"),
    );
    expect(source).toContain('textContent = message');
  });

  it('Assets 只在本地模式启动身份插件再加载来源入口', () => {
    const source = createManagedSourceEntry({
      pageType: 'assets',
      sourceEntry: 'src/main.source.tsx',
    });
    expect(source).toContain("config?.runtimeMode === 'local'");
    expect(source.indexOf('await bootstrapSsoAuth({ config })')).toBeLessThan(
      source.indexOf("await import('./main.source')"),
    );
  });

  it('拒绝把任意路径写进入口动态 import', () => {
    expect(() => createManagedSourceEntry({
      pageType: 'site',
      sourceEntry: '../main.tsx',
    })).toThrow('非法来源入口');
  });
});
