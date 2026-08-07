import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const home = mkdtempSync(join(tmpdir(), 'stoclaw-install-manifest-'));
const bundledManifest = {
  dwsVersion: '1.0.50',
  skillMode: 'mono',
  skillsRevision: '1.0.50',
  platforms: {
    'darwin-arm64': { assetName: 'dws-darwin-arm64.tar.gz', url: 'https://example/dws.tar.gz' },
  },
};

describe('resolveConnectorInstallManifest', () => {
  beforeEach(() => {
    process.env.STOCLAW_CONNECTORS_DIR = home;
    vi.resetModules();
  });

  it('reads bundled manifest when manifestUrl uses bundled scheme', async () => {
    const manifestPath = join(process.cwd(), 'resources', 'dws', 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(bundledManifest, null, 2)}\n`, 'utf8');

    const { resolveConnectorInstallManifest } = await import(
      '../../electron/connectors/resolve-install-manifest'
    );
    const manifest = await resolveConnectorInstallManifest({
      connectorId: 'dingtalk-dws',
      installSpec: {
        manifestUrl: 'bundled://resources/dws/manifest.json',
      },
    });

    expect(manifest?.dwsVersion).toBe('1.0.50');
  });
});

afterAll(() => {
  delete process.env.STOCLAW_CONNECTORS_DIR;
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // ignore
  }
});
