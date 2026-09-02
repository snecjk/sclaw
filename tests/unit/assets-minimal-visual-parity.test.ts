import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const templatesRoot = join(process.cwd(), 'resources/app-templates');
const siteRoot = join(templatesRoot, 'site-minimal');
const assetsRoot = join(templatesRoot, 'assets-minimal');

function read(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('assets-minimal visual parity with site-minimal', () => {
  it('shares the STO theme and shell styles', () => {
    for (const path of ['src/theme/tokens.ts', 'src/theme/antd-theme.ts', 'src/theme/theme.css', 'src/index.css']) {
      expect(existsSync(join(assetsRoot, path))).toBe(true);
      expect(read(assetsRoot, path)).toBe(read(siteRoot, path));
    }
  });

  it('provides the same presentational shell building blocks', () => {
    for (const path of [
      'src/components/ContentSection.tsx',
      'src/components/EmptyState.tsx',
      'src/components/PageHeader.tsx',
      'src/layouts/AppSider.tsx',
      'src/layouts/OpenTabs.tsx',
      'src/layouts/PageContainer.tsx',
      'src/layouts/open-tab-state.ts',
    ]) {
      expect(existsSync(join(assetsRoot, path))).toBe(true);
      expect(read(assetsRoot, path)).toBe(read(siteRoot, path));
    }
  });

  it('uses the shared visual shell with static navigation only', () => {
    const app = read(assetsRoot, 'src/App.tsx');
    const layout = read(assetsRoot, 'src/layouts/AppLayout.tsx');
    const main = read(assetsRoot, 'src/main.tsx');

    expect(app).toContain('theme={stoAntdTheme}');
    expect(layout).toContain('<AppHeader />');
    expect(layout).toContain('<OpenTabs');
    expect(layout).toContain('<AppSider');
    expect(layout).toContain('<PageContainer>');
    expect(layout).not.toContain('useAuthorizedMenu');
    expect(main).toContain("import './theme/theme.css'");
  });

  it('emits stable production asset filenames without content hashes', () => {
    const viteConfig = read(assetsRoot, 'vite.config.ts');

    expect(viteConfig).toContain("entryFileNames: 'assets/[name].js'");
    expect(viteConfig).toContain("chunkFileNames: 'assets/[name].js'");
    expect(viteConfig).toContain("assetFileNames: 'assets/[name][extname]'");
  });
});
