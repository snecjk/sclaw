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

  it('site 自行完成 SSO，assets 只接收宿主身份', () => {
    const siteMain = readFileSync(join(resources, 'site-minimal', 'src', 'main.tsx'), 'utf8');
    const assetsMain = readFileSync(join(resources, 'assets-minimal', 'src', 'main.tsx'), 'utf8');

    expect(siteMain).toContain('checkAndRedirectToLogin');
    expect(assetsMain).toContain('captureStoTokenFromUrl');
    expect(assetsMain).not.toContain('checkAndRedirectToLogin');
  });
});
