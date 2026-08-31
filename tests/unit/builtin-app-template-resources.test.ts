import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const resources = join(process.cwd(), 'resources', 'app-templates');

describe('built-in app template resources', () => {
  for (const pageType of ['site', 'assets'] as const) {
    it(`${pageType}-minimal 提供可发布的根目录 manifest`, () => {
      const templateId = `${pageType}-minimal`;
      const root = join(resources, templateId);
      const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

      expect(manifest).toMatchObject({ schemaVersion: 1, templateId, pageType });
      expect(manifest).not.toHaveProperty('version');
      expect(existsSync(join(root, 'package.json'))).toBe(true);
      expect(existsSync(join(root, 'src'))).toBe(true);
      expect(existsSync(join(root, '.env'))).toBe(false);
      expect(existsSync(join(root, '.env.example'))).toBe(true);
    });
  }

  it('site 负责发布态 SSO，assets 仅在本地使用 SClaw 当前身份', () => {
    const siteMain = readFileSync(join(resources, 'site-minimal', 'src', 'main.tsx'), 'utf8');
    const assetsMain = readFileSync(join(resources, 'assets-minimal', 'src', 'main.tsx'), 'utf8');
    const sitePackage = JSON.parse(
      readFileSync(join(resources, 'site-minimal', 'package.json'), 'utf8'),
    );
    const assetsPackage = JSON.parse(
      readFileSync(join(resources, 'assets-minimal', 'package.json'), 'utf8'),
    );

    expect(sitePackage.dependencies).toMatchObject({
      '@sto/sclaw-plugin-sso-auth': '0.1.3',
    });
    expect(siteMain).toContain('bootstrapInstalledPlugins');
    expect(assetsPackage.dependencies).toMatchObject({
      '@sto/sclaw-plugin-sso-auth': '0.1.3',
    });
    expect(assetsMain).toContain('bootstrapSsoAuth');
    expect(assetsMain).toContain("runtimeMode === 'local'");
    expect(assetsMain).toContain('fetch: window.fetch.bind(window)');
    expect(assetsMain).not.toContain('captureStoTokenFromUrl');
  });

  it('assets 提供 Policy Ontology SDK 开发能力插件', () => {
    const catalogRoot = join(resources, 'assets-minimal', 'openspec', 'skill-catalog');
    const packagesManifest = JSON.parse(
      readFileSync(join(catalogRoot, 'packages.manifest.json'), 'utf8'),
    );
    const plugin = packagesManifest.packages.find(
      (item: { id?: string }) => item.id === 'fe-policy-ontology-sdk',
    );

    expect(plugin).toMatchObject({
      kind: 'frontend',
      packageName: '@sto/policy-ontology-sdk',
      npmPackages: ['@sto/policy-ontology-sdk@0.1.0'],
      ai: { skillId: 'pkg-policy-ontology-sdk' },
    });
    expect(existsSync(join(catalogRoot, 'pkg-policy-ontology-sdk', 'SKILL.md'))).toBe(true);
  });

  it('site 提供统一主题入口', () => {
    const siteRoot = join(resources, 'site-minimal');

    expect(readFileSync(join(siteRoot, 'src/theme/tokens.ts'), 'utf8'))
      .toContain('export const STO_THEME_TOKENS');
    expect(readFileSync(join(siteRoot, 'src/theme/antd-theme.ts'), 'utf8'))
      .toContain('export const stoAntdTheme');
    expect(readFileSync(join(siteRoot, 'src/theme/theme.css'), 'utf8'))
      .toContain('--sto-color-primary');
  });

  it('site 提供简洁可扩展的应用骨架', () => {
    const siteRoot = join(resources, 'site-minimal');

    expect(readFileSync(join(siteRoot, 'src/layouts/AppHeader.tsx'), 'utf8'))
      .toContain('export function AppHeader');
    expect(readFileSync(join(siteRoot, 'src/layouts/AppSider.tsx'), 'utf8'))
      .toContain('export function AppSider');
    expect(readFileSync(join(siteRoot, 'src/layouts/PageContainer.tsx'), 'utf8'))
      .toContain('export function PageContainer');

    const navigation = readFileSync(join(siteRoot, 'src/layouts/nav-config.ts'), 'utf8');
    expect(navigation).not.toContain('业务办理');
    expect(navigation).not.toContain('系统设置');
  });
});
