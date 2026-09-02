import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('app page type visible copy', () => {
  it('uses Site and Assets in user-facing app development components', () => {
    const files = [
      'src/components/more-apps/CreateAppDialog.tsx',
      'src/components/more-apps/DevAppCard.tsx',
      'src/components/more-apps/TemplateProjectUploadDialog.tsx',
      'src/components/more-apps/AppTemplateManagerDialog.tsx',
      'src/components/app-dev/AppDevPageTypeBadge.tsx',
      'src/components/app-dev/StoAppDeployDialog.tsx',
      'src/components/app-dev/StoAppMenuPublishDialog.tsx',
    ].map((path) => readFileSync(join(root, path), 'utf8')).join('\n');

    expect(files).not.toMatch(/独立站点|托管应用/);
    expect(files).toContain("label: 'Site'");
    expect(files).toContain("label: 'Assets'");
    expect(files).toContain('内嵌子应用，发布后需依赖主应用访问');
  });

  it('uses the standard template display names', () => {
    const site = JSON.parse(readFileSync(join(root, 'resources/app-templates/site-minimal/manifest.json'), 'utf8'));
    const assets = JSON.parse(readFileSync(join(root, 'resources/app-templates/assets-minimal/manifest.json'), 'utf8'));

    expect(site.name).toBe('标准 Site 模版');
    expect(assets.name).toBe('标准 Assets 模版');
  });

  it('removes the deprecated sclaw services command from built-in templates', () => {
    for (const templateId of ['site-minimal', 'assets-minimal']) {
      const templateRoot = join(root, 'resources/app-templates', templateId);
      const packageJson = JSON.parse(readFileSync(join(templateRoot, 'package.json'), 'utf8'));
      expect(packageJson.scripts).not.toHaveProperty('sclaw:services');
      expect(existsSync(join(templateRoot, 'scripts/external-services.mjs'))).toBe(false);
    }
  });
});
