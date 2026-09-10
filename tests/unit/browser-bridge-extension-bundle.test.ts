import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../browser-extension');

describe('bundled browser-bridge extension', () => {
  it('ships manifest version matching the zip name', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      name?: string;
      version?: string;
      content_scripts?: unknown;
      host_permissions?: string[];
      permissions?: string[];
      action?: { default_popup?: string };
      side_panel?: { default_path?: string };
    };
    expect(manifest.name).toBe('SClaw Web Bridge');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.host_permissions).toEqual([
      'http://127.0.0.1/*',
      'http://localhost/*',
    ]);
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel?.default_path).toBe('sidepanel.html');
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(existsSync(join(root, 'sidepanel.html'))).toBe(true);
    const zipName = `sclaw-web-bridge-${manifest.version}.zip`;
    expect(existsSync(join(root, 'dist', zipName))).toBe(true);
    const listing = execFileSync('unzip', ['-Z1', join(root, 'dist', zipName)], { encoding: 'utf8' });
    expect(listing).toContain('sidepanel.html');
    expect(existsSync(join(root, 'background.js'))).toBe(true);
    expect(existsSync(join(root, 'page-agent.js'))).toBe(true);
    expect(existsSync(join(root, 'scripts', 'pack.mjs'))).toBe(true);
  });
});
