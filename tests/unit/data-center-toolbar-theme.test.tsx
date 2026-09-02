import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataCenter } from '@/pages/DataCenter';
import { useDataCenterStore } from '@/stores/data-center';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: { value?: string }) => {
      const labels: Record<string, string> = {
        'dataCenterPage.toolbar.searchPlaceholder': '搜索文件或文件夹',
        'dataCenterPage.toolbar.associationAll': '全部',
        'dataCenterPage.toolbar.associationTask': '定时任务',
        'dataCenterPage.toolbar.gridView': '网格视图',
        'dataCenterPage.toolbar.listView': '列表视图',
        'dataCenterPage.toolbar.createFolder': '新建文件夹',
        'dataCenterPage.sections.financeReport': '我的报表',
      };
      if (key === 'dataCenterPage.toolbar.associationLabel') return `关联：${options?.value ?? ''}`;
      return labels[key] ?? key;
    },
  }),
}));

const initialDataCenterState = useDataCenterStore.getState();
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

function themeTokenDeclarations(theme: 'light' | 'dark'): Map<string, string> {
  const declarations = new Map<string, string>();
  const root = postcss.parse(flattenLayer(tokensCss));
  root.walkRules((rule) => {
    const selectors = rule.selector.split(',').map((selector) => selector.trim());
    const isBase = selectors.includes(':root');
    const isDark = selectors.includes('.dark');
    if (!isBase && !(theme === 'dark' && isDark)) return;
    rule.walkDecls(/^--/, (declaration) => declarations.set(declaration.prop, declaration.value));
  });
  return declarations;
}

function resolveToken(token: string, declarations: Map<string, string>): string {
  let value = declarations.get(token);
  if (!value) throw new Error(`Missing dark token ${token}`);
  for (let depth = 0; depth < 12 && value.includes('var('); depth += 1) {
    value = value.replace(/var\((--[\w-]+)\)/g, (_match, dependency: string) => {
      const resolved = declarations.get(dependency);
      if (!resolved) throw new Error(`Missing dependency ${dependency} for ${token}`);
      return resolved;
    });
  }
  return value;
}

function installControlRecipes(theme: 'light' | 'dark'): () => void {
  const declarations = themeTokenDeclarations(theme);
  const root = postcss.parse(flattenLayer(recipesCss));
  root.walkRules((rule) => {
    if (!rule.selector.includes('.sto-control') && !rule.selector.includes('.sto-segment-item')) {
      rule.remove();
    }
  });
  const style = document.createElement('style');
  style.dataset.dataCenterToolbarThemeTest = '';
  const themeVariables = Array.from(declarations.entries())
    .map(([token, value]) => `${token}: ${value};`)
    .join('\n');
  style.textContent = `:root {\n${themeVariables}\n}\n${root.toString().replace(
    /var\((--sto-[\w-]+)\)/g,
    (match, token: string) => declarations.has(token) ? resolveToken(token, declarations) : match,
  )}`;
  document.documentElement.className = theme === 'dark' ? 'dark' : '';
  document.head.append(style);
  return () => {
    style.remove();
    document.documentElement.className = '';
  };
}

function renderToolbar() {
  useDataCenterStore.setState({
    section: 'qa_artifact',
    spaceType: 'qa_artifact',
    spaceId: null,
    items: [],
    keyword: '',
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
    refreshQuota: vi.fn().mockResolvedValue(undefined),
  });
  render(
    <MemoryRouter initialEntries={['/data-center?section=qa_artifact']}>
      <DataCenter />
    </MemoryRouter>,
  );
}

afterEach(() => {
  useDataCenterStore.setState(initialDataCenterState, true);
  document.querySelectorAll('style[data-data-center-toolbar-theme-test]').forEach((style) => style.remove());
  document.documentElement.className = '';
});

describe('data center toolbar theme', () => {
  it('shows the finance report tab', () => {
    renderToolbar();

    expect(screen.getByRole('tab', { name: '我的报表' })).toBeTruthy();
  });

  it('uses one dark resting surface for search, filter, view switch, and create action', () => {
    const dispose = installControlRecipes('dark');
    renderToolbar();

    const search = screen.getByPlaceholderText('搜索文件或文件夹').parentElement;
    const association = screen.getByRole('button', { name: '关联：全部' });
    const viewSwitch = screen.getByRole('button', { name: '列表视图' }).parentElement;
    const createFolder = screen.getByRole('button', { name: '新建文件夹' });

    for (const control of [search, association, viewSwitch, createFolder]) {
      if (!(control instanceof HTMLElement)) throw new Error('Expected toolbar control shell');
      const computed = getComputedStyle(control);
      expect(computed.backgroundColor).toBe('rgb(33, 33, 33)');
      expect(computed.borderTopColor).toBe('rgba(255, 255, 255, 0.08)');
    }
    dispose();
  });

  it('lightens interactive toolbar controls without strengthening the outline', () => {
    const dispose = installControlRecipes('dark');
    renderToolbar();

    const search = screen.getByPlaceholderText('搜索文件或文件夹').parentElement;
    const association = screen.getByRole('button', { name: '关联：全部' });
    const viewOption = screen.getByRole('button', { name: '网格视图' });
    const viewSwitch = viewOption.parentElement;
    const createFolder = screen.getByRole('button', { name: '新建文件夹' });

    for (const control of [search, association, createFolder]) {
      if (!(control instanceof HTMLElement)) throw new Error('Expected interactive toolbar control');
      control.dataset.stoState = 'hover';
      const computed = getComputedStyle(control);
      expect(computed.backgroundColor).toBe('rgb(40, 40, 40)');
      expect(computed.borderTopColor).toBe('rgba(255, 255, 255, 0.08)');
    }
    if (!(viewSwitch instanceof HTMLElement)) throw new Error('Expected view toolbar surface');
    viewOption.dataset.stoState = 'hover';
    expect(getComputedStyle(viewOption).backgroundColor).toBe('rgb(40, 40, 40)');
    expect(getComputedStyle(viewSwitch).borderTopColor).toBe('rgba(255, 255, 255, 0.08)');
    dispose();
  });

  it('keeps the selected view visible on the unified light toolbar surface', () => {
    const dispose = installControlRecipes('light');
    renderToolbar();

    const selectedView = screen.getByRole('button', { name: '列表视图' });
    expect(getComputedStyle(selectedView).backgroundColor).toBe('rgb(229, 230, 235)');
    dispose();
  });

  it('keeps the search input text semantics and gives it a persistent accessible name', () => {
    renderToolbar();

    expect(screen.getByRole('textbox', { name: '搜索文件或文件夹' })).toBeTruthy();
  });

  it('shows a focus ring on the search surface when its input receives keyboard focus', () => {
    const dispose = installControlRecipes('dark');
    const searchSurface = document.createElement('label');
    searchSurface.className = 'sto-control sto-control--outline sto-control--neutral-outline-default sto-control--data-center-toolbar-interactive';
    const searchInput = document.createElement('input');
    searchSurface.append(searchInput);
    document.body.append(searchSurface);

    searchInput.focus();
    expect(searchSurface.matches(':focus-within')).toBe(true);
    searchSurface.dataset.stoState = 'focus';

    expect(getComputedStyle(searchSurface).boxShadow).not.toBe('');
    expect(getComputedStyle(searchSurface).boxShadow).not.toBe('none');
    searchSurface.remove();
    dispose();
  });

  it('uses the common light hover surface for an unselected view option', () => {
    const dispose = installControlRecipes('light');
    renderToolbar();

    const gridView = screen.getByRole('button', { name: '网格视图' });
    gridView.dataset.stoState = 'hover';

    expect(getComputedStyle(gridView).backgroundColor).toBe('rgb(242, 243, 245)');
    dispose();
  });

  it('keeps the shared toolbar geometry across control families', () => {
    renderToolbar();

    const controls = [
      screen.getByPlaceholderText('搜索文件或文件夹').parentElement,
      screen.getByRole('button', { name: '关联：全部' }),
      screen.getByRole('button', { name: '列表视图' }).parentElement,
      screen.getByRole('button', { name: '新建文件夹' }),
    ];

    for (const control of controls) {
      if (!(control instanceof HTMLElement)) throw new Error('Expected toolbar control shell');
      expect(control.className).toContain('h-[34px]');
      expect(control.className).toContain('rounded-[10px]');
    }
  });
});
