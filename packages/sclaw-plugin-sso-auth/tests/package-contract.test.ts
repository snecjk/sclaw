import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = join(import.meta.dirname, '..');

describe('SSO Auth package contract', () => {
  it('publishes one Site-only SClaw plugin package', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, 'sclaw', 'plugin.json'), 'utf8'),
    );

    expect(pkg).toMatchObject({
      name: '@sto/sclaw-plugin-sso-auth',
      version: '0.1.5',
      sclaw: { manifest: './sclaw/plugin.json' },
    });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      id: 'sto.sso-auth',
      pageTypes: ['site'],
      runtime: { entry: './runtime', activation: 'bootstrap' },
      provides: { hostCapabilities: ['auth.sto-token'] },
    });
  });
});
