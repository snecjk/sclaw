import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const afterPack = require('../../scripts/after-pack.cjs') as {
  validateWeixinRuntimeBundle: (dir: string) => {
    ok: boolean;
    error?: string;
    files: string[];
  };
};

describe('validateWeixinRuntimeBundle', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('accepts only worker-entry.js + package.json', () => {
    root = mkdtempSync(join(tmpdir(), 'weixin-rt-ok-'));
    writeFileSync(join(root, 'worker-entry.js'), '// entry');
    writeFileSync(join(root, 'package.json'), '{}');
    expect(afterPack.validateWeixinRuntimeBundle(root).ok).toBe(true);
  });

  it('rejects vendor/spike/test leftovers', () => {
    root = mkdtempSync(join(tmpdir(), 'weixin-rt-bad-'));
    writeFileSync(join(root, 'worker-entry.js'), '// entry');
    writeFileSync(join(root, 'package.json'), '{}');
    mkdirSync(join(root, 'vendor'));
    const result = afterPack.validateWeixinRuntimeBundle(root);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/forbidden/);
  });
});
