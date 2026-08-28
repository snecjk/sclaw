import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chatComposerHomeShellClass,
  chatComposerHomeStackShellClass,
  myTaskCreateButtonClass,
  myTaskSectionTabClass,
  myTaskSectionTabsTrackClass,
  myTaskSortTriggerClass,
  stoSegmentTabClass,
  stoSegmentTabsTrackClass,
  stoMainCardShellClass,
  stoPreviewContentShellClass,
  stoTaskSubitemChatCanvasBg,
} from '@/lib/surfaces';

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

describe('app shell surface tokens (Stage 4)', () => {
  it('defines L0/L1/L2/edge/shadow tokens in light and dark roots', () => {
    for (const token of [
      '--sto-shell-bg',
      '--sto-workspace-bg',
      '--sto-panel-bg',
      '--sto-surface-edge',
      '--sto-workspace-shadow',
    ]) {
      expect(globalsCss).toContain(`${token}:`);
    }

    const root = extractBlock(globalsCss, ':root {');
    const dark = extractBlock(globalsCss, '.dark {');

    for (const block of [root, dark]) {
      expect(block).toMatch(/--sto-page-bg:\s*var\(--sto-shell-bg\)/);
      expect(block).toMatch(/--sto-sidebar-bg:\s*var\(--sto-shell-bg\)/);
      expect(block).toMatch(/--sto-main-card-bg:\s*var\(--sto-workspace-bg\)/);
      expect(block).toMatch(/--sto-main-card-shadow:\s*var\(--sto-workspace-shadow\)/);
    }
  });

  it('keeps dark Sidebar on the same L0 token as Shell (no hue fork)', () => {
    const dark = extractBlock(globalsCss, '.dark {');
    expect(dark).toMatch(/--sto-sidebar-bg:\s*var\(--sto-shell-bg\)/);
    expect(dark).not.toMatch(/--sto-sidebar-bg:\s*hsl\(/);
  });

  it('maps Workspace shell surfaces to L1 tokens', () => {
    expect(stoMainCardShellClass).toContain('bg-[var(--sto-main-card-bg)]');
    expect(stoMainCardShellClass).toContain('shadow-[var(--sto-main-card-shadow)]');
    expect(stoTaskSubitemChatCanvasBg).toBe('bg-[var(--sto-main-card-bg)]');
    expect(stoTaskSubitemChatCanvasBg).not.toContain('dark:bg-background');
  });

  it('maps Preview and Composer to L2 panel tokens (no theme-only bg-white/card fork)', () => {
    expect(stoPreviewContentShellClass).toContain('bg-[var(--sto-panel-bg)]');
    expect(stoPreviewContentShellClass).toContain('border-[color:var(--sto-surface-edge)]');
    expect(stoPreviewContentShellClass).not.toContain('bg-white');
    expect(stoPreviewContentShellClass).not.toContain('dark:bg-card');

    expect(chatComposerHomeShellClass).toContain('bg-[var(--sto-panel-bg)]');
    expect(chatComposerHomeShellClass).toContain('border-[color:var(--sto-surface-edge)]');
    expect(chatComposerHomeShellClass).not.toContain('bg-card');
    expect(chatComposerHomeShellClass).not.toContain('dark:shadow-[');

    // 外层 nest：比 workspace 略深、比 shell 更淡；禁止绑回 workspace-bg（会与主卡片同色）
    expect(chatComposerHomeStackShellClass).toContain('bg-[#F5F5F5]');
    expect(chatComposerHomeStackShellClass).not.toContain('bg-[var(--sto-workspace-bg)]');
  });

  it('does not introduce collapse/expanded dedicated shell background classes', () => {
    const surfaces = readFileSync(resolve(process.cwd(), 'src/lib/surfaces.ts'), 'utf8');
    expect(surfaces).not.toMatch(/collapsed.*bg-\[#|expanded.*bg-\[#/i);
    expect(surfaces).not.toContain('sto-collapsed-shell-bg');
    expect(surfaces).not.toContain('sto-expanded-shell-bg');
  });

  it('MainLayout provincial shell still binds L0 token without layout redesign', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/layout/MainLayout.tsx'),
      'utf8',
    );
    expect(src).toContain('bg-[var(--sto-shell-bg)]');
    expect(src).toContain('stoAppShellGridProvincialClass');
  });

  it('keeps My Task surface exports as aliases of neutral shared classes', () => {
    expect(myTaskSectionTabsTrackClass).toBe(stoSegmentTabsTrackClass);
    expect(myTaskSectionTabClass(true)).toBe(stoSegmentTabClass(true));
    expect(myTaskSectionTabClass(false)).toBe(stoSegmentTabClass(false));
    expect(myTaskCreateButtonClass).toContain('dark:bg-[var(--sto-control-bg)]');
    expect(myTaskCreateButtonClass).toContain('h-[34px]');
    expect(myTaskSortTriggerClass).toContain('dark:bg-[var(--sto-control-bg)]');
    expect(myTaskSortTriggerClass).toContain('h-[34px]');
  });

  it('preserves My Task compatibility light interactions while using semantic dark controls', () => {
    expect(myTaskCreateButtonClass).toContain('text-foreground');
    expect(myTaskCreateButtonClass).toContain('hover:bg-black/[0.04]');
    expect(myTaskCreateButtonClass).toContain('active:scale-[0.98]');
    expect(myTaskCreateButtonClass).toContain('focus-visible:ring-2');
    expect(myTaskSortTriggerClass).toContain('font-medium');
    expect(myTaskCreateButtonClass).toContain('dark:bg-[var(--sto-control-bg)]');
    expect(myTaskSortTriggerClass).toContain('dark:bg-[var(--sto-control-bg)]');
  });
});
