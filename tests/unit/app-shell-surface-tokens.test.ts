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
  sidebarNavExpandedActiveClass,
  sidebarNavExpandedIdleClass,
  sidebarSubitemTextActiveClass,
  sidebarSubitemTextIdleClass,
} from '@/lib/surfaces';

const globalsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);
const themeTokensCss = readFileSync(
  resolve(process.cwd(), 'src/styles/theme/tokens.css'),
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

function extractThemeBlock(marker: ':root {' | '.dark {'): string {
  const tokenMarker = marker === ':root {' ? ':root,' : '.dark,';
  return `${extractBlock(themeTokensCss, tokenMarker)}\n${extractBlock(globalsCss, marker)}`;
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
      expect(themeTokensCss).toContain(`${token}:`);
    }

    const root = extractThemeBlock(':root {');
    const dark = extractThemeBlock('.dark {');

    expect(root).toMatch(/--sto-page-bg:\s*var\(--sto-shell-bg\)/);
    expect(root).toMatch(/--sto-sidebar-bg:\s*var\(--sto-shell-bg\)/);
    expect(root).toMatch(/--sto-main-card-bg:\s*var\(--sto-workspace-bg\)/);
    expect(root).toMatch(/--sto-main-card-shadow:\s*var\(--sto-workspace-shadow\)/);

    expect(dark).toMatch(/--sto-page-bg:\s*var\(--sto-surface-under\)/);
    expect(dark).toMatch(/--sto-sidebar-bg:\s*var\(--sto-surface-secondary\)/);
    expect(dark).toMatch(/--sto-main-card-bg:\s*var\(--sto-surface-under\)/);
    expect(dark).toMatch(/--sto-main-card-shadow:\s*var\(--sto-workspace-shadow\)/);
  });

  it('keeps dark Sidebar one neutral level above the content canvas', () => {
    const dark = extractThemeBlock('.dark {');
    expect(dark).toMatch(/--sto-sidebar-bg:\s*var\(--sto-surface-secondary\)/);
    expect(dark).toMatch(/--sto-page-bg:\s*var\(--sto-surface-under\)/);
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
    expect(myTaskCreateButtonClass).toContain('sto-control sto-control--outline');
    expect(myTaskCreateButtonClass).toContain('h-[34px]');
    expect(myTaskSortTriggerClass).toContain('sto-control sto-control--outline');
    expect(myTaskSortTriggerClass).toContain('h-[34px]');
  });

  it('preserves My Task compatibility light interactions while using semantic dark controls', () => {
    expect(myTaskCreateButtonClass).toContain('sto-control--outline');
    expect(myTaskCreateButtonClass).toContain('active:scale-[0.98]');
    expect(myTaskSortTriggerClass).toContain('font-medium');
    expect(myTaskCreateButtonClass).not.toMatch(/bg-\[var|text-foreground|hover:bg-/);
    expect(myTaskSortTriggerClass).not.toMatch(/bg-\[var|text-foreground|hover:bg-/);
  });

  it('routes sidebar hover, selected, and focus colors through Navigation recipes', () => {
    const recipes = readFileSync(
      resolve(process.cwd(), 'src/styles/theme/recipes.css'),
      'utf8',
    );

    for (const className of [
      sidebarNavExpandedIdleClass,
      sidebarNavExpandedActiveClass,
      sidebarSubitemTextIdleClass,
      sidebarSubitemTextActiveClass,
    ]) {
      expect(className).toContain('sto-navigation-item');
      expect(className).not.toContain('hover:bg-[var(--sto-sidebar-row-hover-bg)]');
    }

    expect(recipes).toMatch(/\.sto-navigation-item:is\(:hover,[^}]*background-color:\s*var\(--sto-sidebar-row-hover-bg\)/s);
    expect(recipes).toMatch(/\.sto-navigation-item:is\(\[aria-current='page'\], \[aria-selected='true'\]\)[^}]*background-color:\s*var\(--sto-sidebar-nav-active-bg\)/s);
    expect(recipes).toMatch(/\.sto-navigation-item:is\(:focus-visible, :has\(:focus-visible\), \[data-sto-state='focus'\]\)[^}]*box-shadow:\s*var\(--sto-control-focus-shadow\)/s);
  });

  it('uses the Navigation filter modifier for Skill Plaza categories', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/skill-plaza/SkillPlazaCategoryNav.tsx'),
      'utf8',
    );
    const recipes = readFileSync(
      resolve(process.cwd(), 'src/styles/theme/recipes.css'),
      'utf8',
    );

    expect(source).toContain('sto-navigation-item--filter');
    expect(source).toContain("aria-current={activeCategory === cat.slug ? 'true' : undefined}");
    expect(source).not.toMatch(/bg-\[#E5E6EB\].*dark:bg-/);
    expect(recipes).toMatch(/\.sto-navigation-item--filter\s*\{[^}]*var\(--sto-text-tertiary\)/s);
    expect(recipes).toMatch(/\.sto-navigation-item--filter:is\(\[aria-selected='true'\], \[aria-current='true'\]\)[^}]*var\(--sto-control-active-bg\)/s);
  });
});
