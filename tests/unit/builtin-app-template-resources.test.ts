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

  it('site 采用 STO PC 视觉令牌与壳层尺寸', () => {
    const siteRoot = join(resources, 'site-minimal');
    const tokens = readFileSync(join(siteRoot, 'src/theme/tokens.ts'), 'utf8');
    const css = readFileSync(join(siteRoot, 'src/theme/theme.css'), 'utf8');
    const header = readFileSync(join(siteRoot, 'src/layouts/AppHeader.tsx'), 'utf8');
    const layout = readFileSync(join(siteRoot, 'src/layouts/AppLayout.tsx'), 'utf8');

    expect(tokens).toContain("colorBrand: '#FF6700'");
    expect(tokens).toContain("colorBgLayout: '#F0F2F5'");
    expect(tokens).toContain('controlHeight: 28');
    expect(css).toContain('--sto-shell-topbar: 60px');
    expect(css).toContain('--sto-shell-side: 180px');
    expect(header).toContain('<svg');
    expect(layout).toContain('<OpenTabs');
  });

  it('site 归档包含主题、应用骨架和页面原语', () => {
    const siteRoot = join(resources, 'site-minimal');
    const sourceFiles = [
      'src/theme/theme.css',
      'src/layouts/AppHeader.tsx',
      'src/layouts/AppSider.tsx',
      'src/layouts/PageContainer.tsx',
      'src/components/PageHeader.tsx',
      'src/components/ContentSection.tsx',
      'src/components/EmptyState.tsx',
    ];

    sourceFiles.forEach((file) => {
      expect(existsSync(join(siteRoot, file))).toBe(true);
    });
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

  it('site 首页不预置虚构业务或认证实现说明', () => {
    const siteRoot = join(resources, 'site-minimal');

    expect(readFileSync(join(siteRoot, 'src/components/PageHeader.tsx'), 'utf8'))
      .toContain('export function PageHeader');
    expect(readFileSync(join(siteRoot, 'src/components/EmptyState.tsx'), 'utf8'))
      .toContain('export function EmptyState');

    const home = readFileSync(join(siteRoot, 'src/pages/HomePage.tsx'), 'utf8');
    expect(home).not.toMatch(/今日待办|进行中任务|本周完成|stoToken|SSO Auth/);
    expect(home).not.toContain('__APP_TITLE__');
    expect(home).not.toContain('breadcrumbs=');
  });

  it('site 将开发示例与真实业务请求隔离', () => {
    const siteRoot = join(resources, 'site-minimal');
    const app = readFileSync(join(siteRoot, 'src/App.tsx'), 'utf8');
    const example = readFileSync(join(siteRoot, 'src/pages/DemoPage.tsx'), 'utf8');

    expect(app).toContain('path="example"');
    expect(example).not.toContain('/api/health');
    expect(example).not.toContain('RequestError');
    expect(example).not.toContain('华东网点巡检');
  });

  it('site 连续白卡模块保留 16px 纵向间距', () => {
    const css = readFileSync(join(resources, 'site-minimal', 'src/index.css'), 'utf8');

    expect(css).toContain('.content-section + .content-section');
    expect(css).toContain('margin-top: var(--sto-space-4)');
  });

  it('两类应用模板都内置完整的 STO PC UI/UX 技能包', () => {
    const requiredFiles = [
      'SKILL.md',
      'tokens.css',
      'tokens.md',
      'shell.md',
      'layouts.md',
      'page-head.md',
      'tabs.md',
      'reference.html',
      'assets/sto-mark.svg',
      'assets/opentab.svg',
      'assets/opentab-home.svg',
      'assets/breadcrumb-sep.svg',
    ];

    for (const template of ['site-minimal', 'assets-minimal']) {
      const skillRoot = join(resources, template, 'openspec', 'skill-catalog', 'sto-pc-visual');
      requiredFiles.forEach((file) => expect(existsSync(join(skillRoot, file))).toBe(true));
    }
  });
});
