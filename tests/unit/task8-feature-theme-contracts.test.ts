import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');
const moreAppsCss = read('src/components/more-apps/more-apps.css');
const appPlazaShellCss = read('src/components/more-apps/app-plaza-shell.css');
const workflowSource = read('src/pages/WorkflowDesigner/workflow-designer.tsx');

const taskEightPairs = [
  ['--sto-feature-foreground-strongest', '#020617', 'var(--sto-text-primary)'],
  ['--sto-feature-foreground-strong', '#0f172a', 'var(--sto-text-primary)'],
  ['--sto-feature-foreground-deep', '#10201d', 'var(--sto-text-primary)'],
  ['--sto-feature-field-foreground', '#172033', 'var(--sto-text-primary)'],
  ['--sto-feature-control-foreground', '#334155', 'var(--sto-text-secondary)'],
  ['--sto-feature-hover-foreground', '#475569', 'var(--sto-icon-primary)'],
  ['--sto-feature-secondary-foreground', '#64748b', 'var(--sto-text-secondary)'],
  ['--sto-feature-subtle-foreground', '#8a97aa', 'var(--sto-text-tertiary)'],
  ['--sto-feature-muted-foreground', '#94a3b8', 'var(--sto-icon-tertiary)'],
  ['--sto-feature-placeholder', '#a7adb8', 'var(--sto-text-tertiary)'],
  ['--sto-feature-divider', '#e2e8f0', 'var(--sto-border-default)'],
  ['--sto-feature-control-border', '#edf2f7', 'var(--sto-border-default)'],
  ['--sto-feature-soft-border', '#dbe4e2', 'var(--sto-border-default)'],
  ['--sto-feature-selected-border', '#dbe4f0', 'var(--sto-border-heavy)'],
  ['--sto-feature-hover-border', '#b6c7c2', 'var(--sto-border-heavy)'],
  ['--sto-feature-hover-background', '#f8fafc', 'var(--sto-surface-elevated)'],
  ['--sto-feature-muted-background', '#f1f5f9', 'var(--sto-surface-elevated)'],
  ['--sto-feature-warning-background', '#fff7ed', 'hsl(var(--primary) / 0.1)'],
  ['--sto-feature-success-background', '#ecfdf5', 'rgb(16 185 129 / 10%)'],
  ['--sto-feature-success-foreground', '#059669', '#34d399'],
  ['--sto-feature-brand-accent', '#f97316', 'var(--sto-brand-primary)'],
  ['--sto-feature-brand-hover', '#ea580c', 'var(--sto-brand-hover)'],
  ['--sto-feature-brand-legacy', '#ff6700', 'var(--sto-brand-primary)'],
  ['--sto-shadow-tone', '#0f172a', '#000000'],
  ['--sto-control-brand-hover-background', '#e67a00', 'var(--sto-brand-hover)'],
  ['--sto-text-quaternary', '#aeb4bd', 'var(--sto-text-tertiary)'],
  ['--sto-border-faint', '#eceef2', 'var(--sto-border-default)'],
  ['--sto-control-fill-hover-background', '#d7dae0', 'var(--sto-border-heavy)'],
  ['--sto-border-interactive', '#d8dce4', 'var(--sto-border-heavy)'],
  ['--sto-border-hairline', '#f0f1f4', 'var(--sto-border-default)'],
  ['--sto-surface-soft-neutral', '#f3f4f6', 'var(--sto-surface-elevated)'],
  ['--sto-feedback-favorite-foreground', '#f59e0b', '#f59e0b'],
  ['--sto-feedback-favorite-active-foreground', '#e11d48', '#fb7185'],
  ['--sto-card-translucent-background', 'rgba(255, 255, 255, 0.92)', 'var(--sto-surface-primary)'],
  ['--sto-card-translucent-border', 'rgba(255, 255, 255, 0.8)', 'var(--sto-border-default)'],
  ['--sto-control-showcase-foreground', '#1a73e8', 'var(--sto-link-foreground)'],
  ['--sto-control-showcase-hover-foreground', '#0b57d0', 'var(--sto-link-foreground)'],
  ['--sto-control-showcase-hover-background', '#f8fbff', 'var(--sto-surface-elevated)'],
  ['--sto-control-showcase-retry-hover-background', '#f3f8ff', 'var(--sto-surface-elevated)'],
  ['--sto-control-quiet-hover-background', '#f7f7f8', 'var(--sto-surface-elevated)'],
  ['--sto-shadow-brand-soft-raised', '0 2px 8px rgba(255, 111, 0, 0.12)', '0 2px 8px rgb(0 0 0 / 28%)'],
  ['--sto-workflow-canvas-grid', '#dfe6ee', 'var(--sto-border-heavy)'],
  ['--sto-workflow-canvas-background', '#f7fbff', 'var(--sto-surface-under)'],
  ['--sto-control-toolbar-background', '#fefefe', 'var(--sto-surface-primary)'],
  ['--sto-control-toolbar-border', '#eeeeee', 'var(--sto-border-default)'],
  ['--sto-control-toolbar-hover-background', '#f4f4f4', 'var(--sto-surface-elevated)'],
  ['--sto-card-map-mask', 'rgba(240, 240, 240, 0.6)', 'color-mix(in srgb, var(--sto-surface-under) 72%, transparent)'],
  ['--sto-border-canvas-soft', '#eef2f7', 'var(--sto-border-default)'],
  ['--sto-border-handle', '#e5edf5', 'var(--sto-border-heavy)'],
  ['--sto-feedback-accent-border', '#fed7aa', 'hsl(var(--primary) / 0.25)'],
  ['--sto-overlay-warm-background', 'linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(252, 249, 244, 0.96))', 'var(--sto-surface-primary)'],
  ['--sto-overlay-warm-scrim', 'rgb(15 23 42 / 30%)', 'rgb(0 0 0 / 60%)'],
  ['--sto-feedback-caution-foreground', '#b45309', '#fcd34d'],
  ['--sto-workflow-trial-success', '#00b54b', 'var(--sto-success-primary)'],
  ['--sto-feedback-notice-border', '#ffd6ba', 'hsl(var(--primary) / 0.25)'],
  ['--sto-feedback-notice-background', '#fff1e8', 'hsl(var(--primary) / 0.1)'],
  ['--sto-browser-backdrop', 'rgba(15, 23, 42, 0.12)', 'rgb(0 0 0 / 45%)'],
] as const;

function taskBlock(fromIndex = 0): string {
  const start = tokensCss.indexOf('    --sto-feature-foreground-strongest:', fromIndex);
  return tokensCss.slice(start, tokensCss.indexOf('    --sto-card-flat-bg:', start));
}

function declarations(source: string): Map<string, string> {
  return new Map([...source.matchAll(/^\s+(--sto-[\w-]+):\s*(.+);$/gm)]
    .map((match) => [match[1], match[2]]));
}

describe('Task 8 feature theme contracts', () => {
  it('preserves every migrated light value and its reviewed dark owner exactly', () => {
    const lightBlock = taskBlock();
    const darkBlock = taskBlock(tokensCss.indexOf(lightBlock) + lightBlock.length);
    const light = declarations(lightBlock);
    const dark = declarations(darkBlock);

    expect([...light]).toEqual(taskEightPairs.map(([role, value]) => [role, value]));
    expect([...dark]).toEqual(taskEightPairs.map(([role, , value]) => [role, value]));
  });

  it('keeps exact legacy expressions on shared roles and recipes without approximations', () => {
    expect(tokensCss).toContain('--background: 220 14% 97%');
    expect(appPlazaShellCss).toContain('background: hsl(var(--background))');
    expect(recipesCss).toContain('border-color: color-mix(in srgb, var(--sto-control-showcase-foreground) 18%, transparent)');
    expect(recipesCss).toContain('box-shadow: 0 4px 12px color-mix(in srgb, var(--sto-control-showcase-foreground) 16%, transparent)');
    expect(workflowSource).toContain('bg-[color-mix(in_srgb,var(--sto-feature-warning-background)_80%,transparent)]');
    expect(workflowSource).toContain('sto-card--workflow-library');
    expect(recipesCss).toContain('background-color: color-mix(in srgb, var(--sto-card-panel-bg) 95%, transparent)');
    expect(recipesCss).toContain('background-color: color-mix(in srgb, var(--sto-card-panel-bg) 90%, transparent)');
    expect(recipesCss).toContain('border-color: color-mix(in srgb, var(--sto-feature-divider) 90%, transparent)');
    for (const shadow of [
      '0 12px 30px color-mix(in srgb, var(--sto-shadow-tone) 7%, transparent)',
      '0 18px 40px color-mix(in srgb, var(--sto-shadow-tone) 12%, transparent)',
      '0 16px 34px color-mix(in srgb, var(--sto-shadow-tone) 8%, transparent)',
      '0 10px 22px color-mix(in srgb, var(--sto-shadow-tone) 4%, transparent)',
      '0 8px 18px color-mix(in srgb, var(--sto-shadow-tone) 14%, transparent)',
      '0 20px 48px color-mix(in srgb, var(--sto-shadow-tone) 12%, transparent)',
      '0 8px 24px color-mix(in srgb, var(--sto-shadow-tone) 14%, transparent)',
      '-8px 0 24px color-mix(in srgb, var(--sto-shadow-tone) 6%, transparent)',
      '0 18px 42px color-mix(in srgb, var(--sto-shadow-tone) 10%, transparent)',
    ]) expect(recipesCss).toContain(shadow);
    expect(moreAppsCss).toContain('0 4px 14px color-mix(in srgb, var(--sto-shadow-tone) 6%, transparent)');
    expect(moreAppsCss).toContain('0 24px 48px color-mix(in srgb, var(--sto-shadow-tone) 16%, transparent)');
    expect(moreAppsCss).not.toMatch(/background:\s*#f7f7f8|border-color:\s*#d8dce4|rgba\(255, 111, 0, 0\.12\)/);
  });
});
