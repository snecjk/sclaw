import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'resources', 'app-templates', 'site-minimal');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('site-minimal SSO Auth plugin contract', () => {
  it('statically activates the Site-only plugin before rendering the application', () => {
    expect(read('vite.config.ts')).toContain('ssoAuthVite()');
    expect(read('src/sclaw/plugins.generated.ts')).toContain(
      "@sto/sclaw-plugin-sso-auth/runtime",
    );
    expect(read('src/sclaw/bootstrap.ts')).toContain('activateInstalledPlugins');
    expect(read('src/main.tsx')).toContain('bootstrapInstalledPlugins');
  });

  it('keeps SSO protocol implementation out of the template', () => {
    for (const path of [
      'src/lib/sso.ts',
      'src/lib/sso-api.ts',
      'src/lib/sso-config.ts',
      'src/lib/auth-token.ts',
      'src/lib/session.ts',
      'src/components/SsoAuthShell.tsx',
      'scripts/sso-env.mjs',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }

    const source = [
      read('src/main.tsx'),
      read('src/lib/request.ts'),
      read('vite.config.ts'),
    ].join('\n');
    expect(source).not.toMatch(
      /buildSsoLoginUrl|checkAndRedirectToLogin|\/sso-api|VITE_SSO_ENV|captureStoTokenFromUrl/,
    );
  });

  it('uses the initialized plugin identity in requests and header UI', () => {
    expect(read('src/lib/request.ts')).toContain('getSsoAuth()');
    expect(read('src/layouts/AppHeader.tsx')).toContain('getSsoAuth()');
  });
});
