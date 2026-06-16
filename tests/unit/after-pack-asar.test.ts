import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const afterPack = require('../../scripts/after-pack.cjs') as {
  OPENCLAW_ASAR_UNPACK: string;
  packDirectoryToAsar: (sourceDir: string, asarPath: string, label: string) => Promise<boolean>;
  validateAsarNativeUnpack: (asarPath: string, label: string) => void;
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeMinimalOpenclawSource(root: string): void {
  const imgScope = join(root, 'node_modules', '@img', 'sharp-libvips-darwin-arm64', 'lib');
  mkdirSync(imgScope, { recursive: true });
  writeFileSync(join(imgScope, 'libvips-cpp.8.17.3.dylib'), 'fake-libvips');
  writeFileSync(join(root, 'openclaw.mjs'), 'export {};\n');
  writeFileSync(join(root, 'package.json'), '{"name":"openclaw"}\n');
}

describe('after-pack ASAR native unpack', () => {
  it('OPENCLAW_ASAR_UNPACK uses brace expansion for minimatch OR patterns', () => {
    const pattern = afterPack.OPENCLAW_ASAR_UNPACK;
    expect(pattern.startsWith('{')).toBe(true);
    expect(pattern.endsWith('}')).toBe(true);
    expect(pattern).toContain('**/@img/**');
    expect(pattern).toContain('**/sharp/**');
    expect(pattern).toContain('**/*.dylib');
    expect(pattern).toContain('**/@lydell/**');
    expect(pattern).toContain('**/@reflink/**');
  });

  it('packDirectoryToAsar extracts native modules to .unpacked', async () => {
    const bundleRoot = process.cwd();
    const source = join(bundleRoot, 'build', 'openclaw');
    if (!require('node:fs').existsSync(join(source, 'node_modules', '@img'))) {
      // Skip when bundle-openclaw has not been run in this workspace.
      return;
    }

    const tmp = makeTempDir('after-pack-asar-');
    const asarPath = join(tmp, 'openclaw.asar');
    const ok = await afterPack.packDirectoryToAsar(source, asarPath, 'OpenClaw runtime');
    expect(ok).toBe(true);
    expect(require('node:fs').existsSync(`${asarPath}.unpacked`)).toBe(true);
    expect(require('node:fs').existsSync(
      join(`${asarPath}.unpacked`, 'node_modules', '@img'),
    )).toBe(true);
  }, 120_000);

  it('validateAsarNativeUnpack rejects missing libvips', () => {
    const tmp = makeTempDir('after-pack-validate-');
    const asarPath = join(tmp, 'test.asar');
    const unpacked = `${asarPath}.unpacked`;
    mkdirSync(unpacked, { recursive: true });

    expect(() => afterPack.validateAsarNativeUnpack(asarPath, 'OpenClaw runtime')).toThrow(
      /ASAR unpack failed/,
    );
  });

  it('validateAsarNativeUnpack passes when libvips is present', () => {
    const tmp = makeTempDir('after-pack-validate-ok-');
    const asarPath = join(tmp, 'test.asar');
    writeMinimalOpenclawSource(`${asarPath}.unpacked`);

    expect(() => afterPack.validateAsarNativeUnpack(asarPath, 'OpenClaw runtime')).not.toThrow();
  });

  it('validateAsarNativeUnpack allows plugins ASAR without .unpacked', () => {
    const tmp = makeTempDir('after-pack-plugins-');
    const asarPath = join(tmp, 'openclaw-plugins.asar');

    expect(() => afterPack.validateAsarNativeUnpack(asarPath, 'OpenClaw plugins')).not.toThrow();
  });
});
