import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EntryList } from '@/pages/DataCenter/components/entries';
import type { DataCenterUiEntry, EntryRenderProps } from '@/pages/DataCenter/types';

type Theme = 'light' | 'dark';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');

function flattenLayer(css: string): string {
  const root = postcss.parse(css);
  const layer = root.nodes.find(
    (node): node is postcss.AtRule => node.type === 'atrule' && node.name === 'layer',
  );
  return (layer?.nodes ?? root.nodes).map((node) => node.toString()).join('\n');
}

function resolveThemeToken(token: string, theme: Theme): string {
  const declarations = new Map<string, string>();
  const root = postcss.parse(flattenLayer(tokensCss));
  root.walkRules((rule) => {
    const selectors = rule.selector.split(',').map((selector) => selector.trim());
    const isBase = selectors.includes(':root');
    const isDark = selectors.includes('.dark');
    if (!isBase && !(theme === 'dark' && isDark)) return;
    rule.walkDecls(/^--/, (declaration) => declarations.set(declaration.prop, declaration.value));
  });

  let value = declarations.get(token);
  if (!value) throw new Error(`Missing ${theme} token ${token}`);
  for (let depth = 0; depth < 12 && value.includes('var('); depth += 1) {
    value = value.replace(/var\((--[\w-]+)\)/g, (_match, dependency: string) => {
      const resolved = declarations.get(dependency);
      if (!resolved) throw new Error(`Missing dependency ${dependency} for ${token}`);
      return resolved;
    });
  }
  return value;
}

function cardRecipeCss(theme: Theme): string {
  const root = postcss.parse(flattenLayer(recipesCss));
  root.walkRules((rule) => {
    if (!rule.selector.includes('.sto-card')) rule.remove();
  });
  return root.toString().replace(/var\((--sto-[\w-]+)\)/g, (_match, token: string) => (
    resolveThemeToken(token, theme)
  ));
}

function installDataCenterThemeStyles(theme: Theme): () => void {
  document.documentElement.className = theme === 'dark' ? 'dark' : '';
  document.documentElement.dataset.stoTheme = theme;
  const style = document.createElement('style');
  style.dataset.dataCenterThemeTest = '';
  style.textContent = cardRecipeCss(theme);
  document.head.append(style);
  return () => {
    style.remove();
    document.documentElement.className = '';
    delete document.documentElement.dataset.stoTheme;
  };
}

const entry: DataCenterUiEntry = {
  entryId: 'entry-1',
  spaceType: 'qa_artifact',
  entryType: 'file',
  parentEntryId: 'root',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  fileExt: 'pdf',
  fileSize: 1024,
  sourceType: 'chat_artifact',
  status: 'active',
  createdAt: '2026-08-31T10:00:00+08:00',
  updatedAt: '2026-08-31T10:00:00+08:00',
};

function renderEntryList(): HTMLElement {
  const props: EntryRenderProps = {
    items: [entry],
    allowUploadToShared: false,
    onOpenFolder: vi.fn(),
    onPreview: vi.fn(),
    onDownload: vi.fn(),
    onShare: vi.fn(),
    onUploadToShared: vi.fn(),
    onMove: vi.fn(),
    onMoveToFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onTrace: vi.fn(),
  };
  render(
    <TooltipProvider>
      <EntryList {...props} />
    </TooltipProvider>,
  );
  const row = screen.getByText(entry.name).closest('.sto-card');
  if (!(row instanceof HTMLElement)) throw new Error('Expected semantic data-center entry row');
  return row;
}

afterEach(() => {
  document.querySelectorAll('style[data-data-center-theme-test]').forEach((style) => style.remove());
  document.documentElement.className = '';
  delete document.documentElement.dataset.stoTheme;
});

describe('data center entry list theme', () => {
  it.each([
    ['light', 'rgb(255, 255, 255)', 'rgb(229, 230, 235)', 'none'],
    ['dark', 'rgb(24, 24, 24)', 'rgba(255, 255, 255, 0.08)', 'none'],
  ] as const)('keeps the %s resting row visibly card-shaped', (theme, background, border, shadow) => {
    const dispose = installDataCenterThemeStyles(theme);
    const row = renderEntryList();
    const computed = getComputedStyle(row);

    expect(computed.backgroundColor).toBe(background);
    expect(computed.borderTopColor).toBe(border);
    expect(computed.boxShadow).toBe(shadow);
    dispose();
  });

  it('lightens the dark row on interaction without strengthening its outline', () => {
    const dispose = installDataCenterThemeStyles('dark');
    const row = renderEntryList();
    row.dataset.stoState = 'hover';
    const computed = getComputedStyle(row);

    expect(computed.backgroundColor).toBe('rgb(33, 33, 33)');
    expect(computed.borderTopColor).toBe('rgba(255, 255, 255, 0.08)');
    expect(computed.boxShadow).toBe('none');
    dispose();
  });
});
