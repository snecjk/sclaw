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
const recipesCss = readFileSync(
  resolve(process.cwd(), 'src/styles/theme/recipes.css'),
  'utf8',
);
const composerAttachMenuSource = readFileSync(
  resolve(process.cwd(), 'src/components/attachments/ComposerAttachMenu.tsx'),
  'utf8',
);
const artifactProductCardSource = readFileSync(
  resolve(process.cwd(), 'src/components/chat/artifact-product-card.tsx'),
  'utf8',
);
const inputComposerSendButtonSource = readFileSync(
  resolve(process.cwd(), 'src/components/input-composer/input-composer-send-button.tsx'),
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

  it('preserves feature light roles through canonical semantic mappings', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--sto-feature-foreground-strong: #0f172a');
    expect(root).toContain('--sto-feature-foreground-strongest: #020617');
    expect(root).toContain('--sto-feature-success-foreground: #059669');
    expect(root).toContain('--sto-feature-secondary-foreground: #64748b');
    expect(root).toContain('--sto-control-brand-hover-background: #e67a00');
    expect(root).toContain('--sto-workflow-canvas-grid: #dfe6ee');
    expect(root).toContain('--sto-workflow-canvas-background: #f7fbff');
    expect(root).toContain('--sto-control-toolbar-background: #fefefe');
    expect(root).toContain('--sto-control-toolbar-border: #eeeeee');
    expect(root).toContain('--sto-control-toolbar-hover-background: #f4f4f4');
    expect(root).toContain('--sto-card-map-mask: rgba(240, 240, 240, 0.6)');
    expect(root).toContain('--sto-border-canvas-soft: #eef2f7');
    expect(root).toContain('--sto-shadow-tone: #0f172a');
    expect(root).toContain('--sto-border-handle: #e5edf5');
    expect(root).toContain('--sto-feedback-accent-border: #fed7aa');
    expect(root).toContain('--sto-overlay-warm-scrim: rgb(15 23 42 / 30%)');
    expect(root).toContain('--sto-feedback-caution-foreground: #b45309');
    expect(root).toContain('--sto-chat-engine-hint-background: #fffbeb');

    expect(moreAppsCss).not.toMatch(/--ma-(?!scrollbar-gutter)/);
    expect(moreAppsCss).toContain('color: var(--sto-segment-plain-selected-foreground)');
    expect(moreAppsCss).toContain('background: var(--sto-card-panel-bg)');
    expect(moreAppsCss).toContain('--sto-art-app-plaza-hero-bg: linear-gradient(135deg, #d6e8ff 0%, #c8ddff 42%, #e0edff 100%)');

    expect(workflowCanvasCss).toContain('var(--sto-workflow-canvas-background)');
    expect(recipesCss).toContain('.sto-card--canvas-node');
    expect(recipesCss).toContain('border-color: var(--sto-border-canvas-soft)');
    expect(recipesCss).toContain('box-shadow: 0 18px 40px color-mix(in srgb, var(--sto-shadow-tone) 12%, transparent)');
    expect(recipesCss).toContain('background-color: color-mix(in srgb, var(--sto-card-panel-bg) 90%, transparent)');
  });

  it('keeps component-local destructive light colors exact while dark stays semantic', () => {
    const root = extractThemeBlock(':root {');
    const dark = extractThemeBlock('.dark {');

    expect(saveArtifactDialogSource).toContain('text-[#F53F3F]');
    expect(saveArtifactDialogSource).toContain(
      'bg-[#F53F3F] px-4 text-[12px] font-normal text-white hover:bg-[#E23B3B] dark:bg-destructive',
    );
    expect(taskCreateModalSource).toContain('text-[var(--sto-dialog-destructive-background)]');
    expect(taskCreateModalSource).toContain(
      'bg-[var(--sto-dialog-destructive-background)] px-4 text-sm text-[hsl(var(--destructive-foreground))] hover:bg-[var(--sto-dialog-destructive-hover-background)]',
    );
    expect(taskCreateModalSource).not.toContain('dark:');
    expect(confirmDialogSource).toContain(
      "variant === 'destructive' && 'bg-[var(--sto-dialog-destructive-background)] hover:bg-[var(--sto-dialog-destructive-hover-background)]'",
    );
    expect(root).toContain('--sto-dialog-destructive-background: #f53f3f');
    expect(root).toContain('--sto-dialog-destructive-hover-background: #e23b3b');
    expect(dark).toContain('--sto-dialog-destructive-background: hsl(var(--destructive))');
    expect(dark).toContain('--sto-dialog-destructive-hover-background: hsl(var(--destructive) / 0.9)');
  });

  it('preserves the exact approved light borders for attachment and artifact menus', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--sto-overlay-menu-border: var(--sto-border-default)');
    expect(root).toContain('--sto-overlay-content-border: var(--sto-surface-edge)');
    expect(recipesCss).toContain(
      '.sto-overlay--menu-border { border-color: var(--sto-overlay-menu-border); }',
    );
    expect(recipesCss).toContain(
      '.sto-overlay--content-border { border-color: var(--sto-overlay-content-border); }',
    );
    expect(composerAttachMenuSource).toContain('sto-overlay--menu-border');
    expect(artifactProductCardSource).toContain('sto-overlay--content-border');
  });

  it('preserves composer send, stop, and unavailable light states through recipes', () => {
    const root = extractThemeBlock(':root {');

    expect(root).toContain('--sto-shadow-brand-action: 0 6px 16px rgba(255, 111, 0, 0.22)');
    expect(root).toContain('--sto-composer-send-border: hsl(var(--primary) / 0.8)');
    expect(root).toContain('--sto-composer-stop-ink: #0f172a');
    expect(root).toContain('--sto-composer-stop-hover-background: #1e293b');
    expect(root).toContain('--sto-composer-unavailable-background: rgb(0 0 0 / 5%)');
    expect(root).toContain('--sto-composer-unavailable-border: rgb(0 0 0 / 8%)');
    expect(root).toContain('--sto-composer-unavailable-foreground: hsl(var(--muted-foreground) / 0.55)');
    expect(inputComposerSendButtonSource).toContain('sto-control--composer-send-action');
    expect(inputComposerSendButtonSource).toContain('sto-control--composer-stop');
    expect(inputComposerSendButtonSource).toContain('sto-control--composer-unavailable');
  });

});
