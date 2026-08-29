import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);

function extractBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = source.slice(start);
  const end = slice.indexOf('\n  }', marker.length);
  expect(end).toBeGreaterThan(0);
  return slice.slice(0, end);
}

describe('dark appearance semantic tokens', () => {
  it('keeps light surfaces unchanged and exposes semantic aliases', () => {
    const root = extractBlock(globalsCss, ':root {');

    expect(root).toContain('--sto-shell-bg: #ededed');
    expect(root).toContain('--sto-workspace-bg: #fafafa');
    expect(root).toContain('--sto-panel-bg: #ffffff');
    expect(root).toMatch(/--sto-surface-under:\s*var\(--sto-shell-bg\)/);
    expect(root).toMatch(/--sto-surface-primary:\s*var\(--sto-workspace-bg\)/);
    expect(root).toMatch(/--sto-surface-secondary:\s*var\(--sto-panel-bg\)/);
    expect(root).toContain('--glass-bg: 220 14% 98%');
    expect(root).toContain('--glass-border: 220 12% 78% / 0.4');
    expect(root).toContain('--canvas-from: #f7f8fa');
    expect(root).toContain('--canvas-via: #f5f6f7');
    expect(root).toContain('--canvas-to: #fafbfc');
    expect(root).toContain('--sto-sidebar-row-hover-bg: #e4e4e4');
    expect(root).toContain('--sto-sidebar-nav-active-bg: #dcdcdc');
    expect(root).toContain('--sto-sidebar-subitem-active-bg: #dcdcdc');
  });

  it('maps dark appearance to the approved neutral palette', () => {
    const dark = extractBlock(globalsCss, '.dark {');

    expect(dark).toContain('--sto-surface-under: #0d0d0d');
    expect(dark).toContain('--sto-surface-primary: #181818');
    expect(dark).toContain('--sto-surface-secondary: #212121');
    expect(dark).toContain('--sto-surface-elevated: #282828');
    expect(dark).toContain('--sto-text-primary: #dfdfdf');
    expect(dark).toContain('--sto-border-default: rgba(255, 255, 255, 0.08)');
    expect(dark).toContain('--glass-bg: 0 0% 12.9%');
    expect(dark).toContain('--glass-border: 0 0% 100% / 0.08');
    expect(dark).toContain('--canvas-from: #0d0d0d');
    expect(dark).toContain('--canvas-via: #181818');
    expect(dark).toContain('--canvas-to: #212121');
    expect(dark).toContain('--sto-sidebar-collapsed-nav-icon-idle: var(--sto-text-tertiary)');
    expect(dark).toContain('--sto-grey-10: var(--sto-text-primary)');
    expect(dark).toContain('--sto-grey-9: var(--sto-text-secondary)');
    expect(dark).toContain('--sto-grey-8: var(--sto-text-tertiary)');
    expect(dark).toContain('--sto-sidebar-row-hover-bg: var(--sto-control-hover-bg)');
    expect(dark).toContain('--sto-sidebar-nav-active-bg: var(--sto-control-active-bg)');
    expect(dark).toContain('--sto-sidebar-subitem-active-bg: var(--sto-control-active-bg)');
    expect(dark).toContain('--sto-sidebar-footer-name: var(--sto-text-primary)');
    expect(dark).toContain('--sto-sidebar-footer-meta: var(--sto-text-tertiary)');
  });
});
