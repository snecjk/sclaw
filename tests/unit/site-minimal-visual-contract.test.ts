import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(process.cwd(), 'resources/app-templates/site-minimal/src/index.css'),
  'utf8',
);
const assetsCss = readFileSync(
  join(process.cwd(), 'resources/app-templates/assets-minimal/src/index.css'),
  'utf8',
);

describe('minimal app templates STO PC visual contract', () => {
  it('uses the soft border token for shell separators and content cards', () => {
    expect(css).toMatch(/\.app-header\s*\{[^}]*border-bottom:\s*var\(--sto-border-width\) solid var\(--sto-color-border-secondary\)/s);
    expect(css).toMatch(/\.app-sider\s*\{[^}]*border-right:\s*var\(--sto-border-width\) solid var\(--sto-color-border-secondary\)/s);
    expect(css).toMatch(/\.content-section\s*\{[^}]*border:\s*var\(--sto-border-width\) solid var\(--sto-color-border-secondary\)/s);
  });

  it('uses the disabled meta color for inactive open-tab close buttons', () => {
    expect(css).toMatch(/\.sto-opentab-close\s*\{[^}]*color:\s*var\(--sto-color-text-disabled\)/s);
    expect(css).toMatch(/\.sto-opentab\.is-active \.sto-opentab-close\s*\{[^}]*color:\s*var\(--sto-color-bg-container\)/s);
  });

  it('uses the soft border token for assets shell separators and content surface', () => {
    expect(assetsCss).toMatch(/--sto-color-border-secondary:\s*#e5e6eb/i);
    expect(assetsCss).toMatch(/\.app-header\s*\{[^}]*border-bottom:\s*1px solid var\(--sto-color-border-secondary\)/s);
    expect(assetsCss).toMatch(/\.app-sider\s*\{[^}]*border-right:\s*1px solid var\(--sto-color-border-secondary\)/s);
    expect(assetsCss).toMatch(/\.app-content\s*\{[^}]*border:\s*1px solid var\(--sto-color-border-secondary\)/s);
  });
});
