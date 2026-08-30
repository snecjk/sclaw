import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const globalsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);
const themeTokensCss = readFileSync(
  resolve(process.cwd(), 'src/styles/theme/tokens.css'),
  'utf8',
);
const moreAppsCss = readFileSync(
  resolve(process.cwd(), 'src/components/more-apps/more-apps.css'),
  'utf8',
);
const workflowCanvasCss = readFileSync(
  resolve(process.cwd(), 'src/pages/WorkflowDesigner/workflow-designer-canvas.css'),
  'utf8',
);
const saveArtifactDialogSource = readFileSync(
  resolve(process.cwd(), 'src/components/file-preview/SaveArtifactDialog.tsx'),
  'utf8',
);
const taskCreateModalSource = readFileSync(
  resolve(process.cwd(), 'src/pages/MyTask/components/TaskCreateModal.tsx'),
  'utf8',
);
const confirmDialogSource = readFileSync(
  resolve(process.cwd(), 'src/components/ui/confirm-dialog.tsx'),
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

describe('light appearance color system', () => {
  it('serves renderer and adaptive preview from the same light token selector', () => {
    expect(themeTokensCss).toContain(':root,');
    expect(themeTokensCss).toContain("html[data-sto-theme='light']");
  });

  it('preserves the base functional palette exactly', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--background: 220 14% 97%');
    expect(root).toContain('--foreground: 220 26% 14%');
    expect(root).toContain('--primary: 26 100% 50%');
    expect(root).toContain('--secondary: 220 14% 96%');
    expect(root).toContain('--muted: 220 13% 96%');
    expect(root).toContain('--muted-foreground: 215 14% 45%');
    expect(root).toContain('--accent: 32 100% 95%');
    expect(root).toContain('--accent-foreground: 26 100% 36%');
    expect(root).toContain('--destructive: 0 84% 60%');
    expect(root).toContain('--success: 130 67% 47%');
    expect(root).toContain('--warning: 38 99% 59%');
    expect(root).toContain('--link: 231 99% 64%');
    expect(root).toContain('--canvas-from: #f7f8fa');
    expect(root).toContain('--canvas-via: #f5f6f7');
    expect(root).toContain('--canvas-to: #fafbfc');
  });

  it('preserves base light surfaces, feedback colors, and Sidebar states', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--sto-text-primary: #1d2129');
    expect(root).toContain('--sto-text-secondary: #4e5969');
    expect(root).toContain('--sto-text-tertiary: #86909c');
    expect(root).toContain('--sto-border-default: #e5e6eb');
    expect(root).toContain('--sto-surface-edge: #e8eaef');
    expect(root).toContain('--sto-shell-bg: #ededed');
    expect(root).toContain('--sto-workspace-bg: #fafafa');
    expect(root).toContain('--sto-panel-bg: #ffffff');
    expect(root).toContain('--sto-control-hover-bg: #f2f3f5');
    expect(root).toContain('--sto-control-active-bg: #e5e6eb');
    expect(root).toContain('--sto-sidebar-text-default: #393e47');
    expect(root).toContain('--sto-sidebar-row-hover-bg: #e4e4e4');
    expect(root).toContain('--sto-sidebar-nav-active-bg: #dcdcdc');
    expect(root).toContain('--sto-sidebar-subitem-active-bg: #dcdcdc');
    expect(root).toContain('--sto-toast-info-border: #d6e1ff');
    expect(root).toContain('--sto-toast-warning-border: #fff1b8');
    expect(root).toContain('--sto-toast-success-bg: #eaf6ee');
    expect(root).toContain('--sto-toast-success-border: #c8ead6');
    expect(root).toContain('--sto-toast-success-icon: #31af65');
  });

  it('keeps the approved dark palette while mapping the same semantic roles', () => {
    const dark = extractThemeBlock('.dark {');

    expect(dark).toContain('--sto-surface-under: #0d0d0d');
    expect(dark).toContain('--sto-surface-primary: #181818');
    expect(dark).toContain('--sto-surface-secondary: #212121');
    expect(dark).toContain('--sto-surface-elevated: #282828');
    expect(dark).toContain('--sto-text-primary: #dfdfdf');
    expect(dark).toContain('--sto-sidebar-row-hover-bg: var(--sto-control-hover-bg)');
    expect(dark).toContain('--sto-sidebar-nav-active-bg: var(--sto-surface-elevated)');
  });

  it('preserves feature-local light colors', () => {
    expect(moreAppsCss).toContain('--ma-orange: #ff6f00');
    expect(moreAppsCss).toContain('--ma-text: #1a1a1a');
    expect(moreAppsCss).toContain('--ma-text-secondary: #86909c');
    expect(moreAppsCss).toContain('--ma-border: #e5e6eb');
    expect(moreAppsCss).toContain('--ma-card: #ffffff');

    expect(workflowCanvasCss).toContain(
      'radial-gradient(circle at 1px 1px, #dfe6ee 1.2px, transparent 1.2px),\n    #f7fbff;',
    );
    expect(workflowCanvasCss).toMatch(
      /\.wf-canvas-node\s*\{[\s\S]*border: 1px solid #eef2f7;[\s\S]*background: #ffffff;[\s\S]*box-shadow: 0 12px 30px rgb\(15 23 42 \/ 7%\);/,
    );
    expect(workflowCanvasCss).toMatch(
      /\.wf-canvas-node\.selected\s*\{[\s\S]*border-color: #dbe4f0;[\s\S]*box-shadow: 0 18px 40px rgb\(15 23 42 \/ 12%\);/,
    );
  });

  it('keeps component-local destructive light colors exact while dark stays semantic', () => {
    const root = extractThemeBlock(':root {');
    const dark = extractThemeBlock('.dark {');

    expect(saveArtifactDialogSource).toContain('text-[#F53F3F]');
    expect(saveArtifactDialogSource).toContain(
      'bg-[#F53F3F] px-4 text-[12px] font-normal text-white hover:bg-[#E23B3B] dark:bg-destructive',
    );
    expect(taskCreateModalSource).toContain('text-[#F53F3F]');
    expect(taskCreateModalSource).toContain(
      'bg-[#F53F3F] px-4 text-sm text-white hover:bg-[#E23B3B] dark:bg-destructive',
    );
    expect(confirmDialogSource).toContain(
      "variant === 'destructive' && 'bg-[var(--sto-dialog-destructive-background)] hover:bg-[var(--sto-dialog-destructive-hover-background)]'",
    );
    expect(root).toContain('--sto-dialog-destructive-background: #f53f3f');
    expect(root).toContain('--sto-dialog-destructive-hover-background: #e23b3b');
    expect(dark).toContain('--sto-dialog-destructive-background: hsl(var(--destructive))');
    expect(dark).toContain('--sto-dialog-destructive-hover-background: hsl(var(--destructive) / 0.9)');
  });

});
