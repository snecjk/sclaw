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
  });

  it('maps dark appearance to the approved neutral palette', () => {
    const dark = extractBlock(globalsCss, '.dark {');

    expect(dark).toContain('--sto-surface-under: #0d0d0d');
    expect(dark).toContain('--sto-surface-primary: #181818');
    expect(dark).toContain('--sto-surface-secondary: #212121');
    expect(dark).toContain('--sto-surface-elevated: #282828');
    expect(dark).toContain('--sto-text-primary: #dfdfdf');
    expect(dark).toContain('--sto-border-default: rgba(255, 255, 255, 0.08)');
  });
});
