import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../browser-extension');

describe('bundled browser-bridge extension', () => {
  it('ships manifest version matching the zip name', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      version?: string;
      content_scripts?: unknown;
      host_permissions?: string[];
    };
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*',
    ]);
    expect(existsSync(join(root, 'dist', `stoclaw-browser-bridge-${manifest.version}.zip`))).toBe(true);
    expect(existsSync(join(root, 'background.js'))).toBe(true);
    expect(existsSync(join(root, 'page-agent.js'))).toBe(true);
    expect(existsSync(join(root, 'scripts', 'pack.mjs'))).toBe(true);
  });
});
