import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');
const states = ['default', 'hover', 'active', 'focus', 'disabled', 'loading', 'error'] as const;
const themes = ['light', 'dark'] as const;

function installTokenMappings(): HTMLStyleElement {
  const style = document.createElement('style');
  const root = postcss.parse(tokensCss);
  const layer = root.nodes.find(
    (node): node is postcss.AtRule => node.type === 'atrule' && node.name === 'layer',
  );
  style.textContent = (layer?.nodes ?? root.nodes).map((node) => node.toString()).join('\n');
  document.head.append(style);
  return style;
}

function useTheme(theme: (typeof themes)[number]): void {
  document.documentElement.className = theme === 'dark' ? 'dark' : '';
  document.documentElement.dataset.stoTheme = theme;
}

function directDeclarations(selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  postcss.parse(recipesCss).walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    for (const node of rule.nodes ?? []) {
      if (node.type === 'decl') declarations[node.prop] = node.value;
    }
  });
  return declarations;
}

function expectSemanticState(selector: string, properties: readonly string[]): void {
  const declarations = directDeclarations(selector);
  for (const property of properties) {
    expect(declarations[property], `${selector} ${property}`).toMatch(/^var\(--sto-/);
  }
}

afterEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.stoTheme;
  document.head.querySelectorAll('style[data-theme-computed-test]').forEach((node) => node.remove());
});

describe('mounted primitive theme recipes', () => {
  it.each(themes)('exposes complete semantic mappings to a %s root', (theme) => {
    const style = installTokenMappings();
    style.dataset.themeComputedTest = '';
    useTheme(theme);

    const computed = getComputedStyle(document.documentElement);
    for (const token of [
      '--sto-focus-ring',
      '--sto-control-disabled-foreground',
      '--sto-control-disabled-background',
      '--sto-control-disabled-border',
      '--sto-loading-foreground',
      '--sto-feedback-success-background',
      '--sto-feedback-warning-background',
      '--sto-feedback-error-background',
    ]) {
      expect(computed.getPropertyValue(token).trim(), `${theme} ${token}`).not.toBe('');
    }
  });

  it.each(themes)('mounts every shared primitive on the %s recipe root', (theme) => {
    useTheme(theme);
    render(
      <>
        <Button data-testid="button" data-state="loading">Action</Button>
        <Card data-testid="card" data-state="error">Card</Card>
        <Input data-testid="input" aria-invalid="true" />
        <Textarea data-testid="textarea" data-state="loading" />
        <Select data-testid="select" disabled><option>One</option></Select>
        <Tabs defaultValue="one">
          <TabsList data-testid="tabs-list">
            <TabsTrigger data-testid="tabs-trigger" value="one">One</TabsTrigger>
          </TabsList>
        </Tabs>
        <Dialog open>
          <DialogContent data-testid="dialog">
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogContent>
        </Dialog>
        <DropdownMenu open>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent data-testid="dropdown">
            <DropdownMenuItem>Item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Help</TooltipTrigger>
            <TooltipContent data-testid="tooltip">Tip</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </>,
    );

    expect(screen.getByTestId('button')).toHaveClass('sto-control');
    expect(screen.getByTestId('card')).toHaveClass('sto-card');
    for (const testId of ['input', 'textarea', 'select']) {
      expect(screen.getByTestId(testId)).toHaveClass('sto-control');
    }
    expect(screen.getByTestId('tabs-trigger')).toHaveClass('sto-segment-item');
    for (const testId of ['dialog', 'dropdown', 'tooltip']) {
      expect(screen.getByTestId(testId)).toHaveClass('sto-overlay');
    }
  });

  it.each(states)('maps a mounted control %s state to the shared recipe', (state) => {
    render(
      <Button
        data-state={state}
        disabled={state === 'disabled'}
        aria-invalid={state === 'error' ? 'true' : undefined}
      >
        Action
      </Button>,
    );

    const control = screen.getByRole('button', { name: 'Action' });
    expect(control).toHaveClass('sto-control');
    expect(control).toHaveAttribute('data-state', state);
    if (state === 'disabled') expect(control).toBeDisabled();
    if (state === 'error') expect(control).toHaveAttribute('aria-invalid', 'true');
  });

  it.each(states)('maps a mounted card %s state to the shared recipe', (state) => {
    render(
      <Card
        data-testid="state-card"
        data-state={state}
        data-selected={state === 'active' ? 'true' : undefined}
        aria-disabled={state === 'disabled' ? 'true' : undefined}
        aria-invalid={state === 'error' ? 'true' : undefined}
      />,
    );

    const card = screen.getByTestId('state-card');
    expect(card).toHaveClass('sto-card');
    expect(card).toHaveAttribute('data-state', state);
  });
});

describe('semantic state declaration coverage', () => {
  const families = [
    'card',
    'control',
    'navigation-item',
    'segment-item',
    'overlay',
    'feedback',
  ] as const;

  it.each(families)('%s owns all seven state colors in recipes.css', (family) => {
    const selectors = {
      default: `.sto-${family}`,
      hover: `.sto-${family}[data-state='hover']`,
      active: `.sto-${family}[data-state='active']`,
      focus: `.sto-${family}[data-state='focus']`,
      disabled: `.sto-${family}[data-state='disabled']`,
      loading: `.sto-${family}[data-state='loading']`,
      error: `.sto-${family}[data-state='error']`,
    } as const;

    for (const selector of Object.values(selectors)) {
      expectSemanticState(selector, ['background-color', 'border-color', 'color']);
    }
    expectSemanticState(selectors.focus, ['outline-color']);
  });

  it('keeps pseudo-class and accessibility selectors attached to every recipe family', () => {
    for (const selector of [
      '.sto-card:hover',
      '.sto-card[data-selected=\'true\']',
      '.sto-card:has(:focus-visible)',
      '.sto-card[aria-disabled=\'true\']',
      '.sto-control:hover',
      '.sto-control:active',
      '.sto-control:focus-visible',
      '.sto-control:disabled',
      '.sto-control[aria-invalid=\'true\']',
      '.sto-navigation-item:hover',
      '.sto-segment-item[aria-selected=\'true\']',
      '.sto-overlay:focus-visible',
      '.sto-feedback[aria-invalid=\'true\']',
    ]) {
      expect(recipesCss, selector).toContain(selector);
    }
  });

  it('uses explicit disabled semantics instead of whole-component opacity', () => {
    expect(recipesCss).not.toMatch(
      /\.sto-(?:control|card)[^{]*\[[^\]]*disabled[^\]]*\][^{]*\{[^}]*opacity\s*:/s,
    );
    expect(recipesCss).toContain('--sto-control-disabled-foreground');
    expect(recipesCss).toContain('--sto-control-disabled-background');
    expect(recipesCss).toContain('--sto-control-disabled-border');
    expect(recipesCss).toContain('--sto-focus-ring');
  });
});
