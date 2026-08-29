import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');
const states = ['default', 'hover', 'active', 'focus', 'disabled', 'loading', 'error'] as const;
const themes = ['light', 'dark'] as const;
const families = ['card', 'control', 'navigation', 'segment', 'overlay', 'feedback'] as const;

type State = (typeof states)[number];
type Theme = (typeof themes)[number];
type Family = (typeof families)[number];
type SemanticProps = Record<string, string | boolean | undefined>;
type StateColors = { background: string; border: string; foreground: string };

function flattenLayer(css: string): string {
  const root = postcss.parse(css);
  const layer = root.nodes.find(
    (node): node is postcss.AtRule => node.type === 'atrule' && node.name === 'layer',
  );
  return (layer?.nodes ?? root.nodes).map((node) => node.toString()).join('\n');
}

function installThemeStyles(): void {
  const style = document.createElement('style');
  style.dataset.themeComputedTest = '';
  style.textContent = `${flattenLayer(tokensCss)}\n${flattenLayer(recipesCss)}\n:is(.sto-card,.sto-control,.sto-navigation-item,.sto-segment-item,.sto-overlay,.sto-feedback){border-style:solid;border-width:1px}`;
  document.head.append(style);
}

function setTheme(theme: Theme): void {
  document.documentElement.className = theme === 'dark' ? 'dark' : '';
  document.documentElement.dataset.stoTheme = theme;
}

function semanticProps(state: State): SemanticProps {
  return {
    'data-sto-state': ['hover', 'active', 'focus'].includes(state) ? state : undefined,
    'aria-disabled': state === 'disabled' ? 'true' : undefined,
    'aria-busy': state === 'loading' ? 'true' : undefined,
    'aria-invalid': state === 'error' ? 'true' : undefined,
  };
}

function mountRepresentative(family: Family, state: State, theme: Theme): HTMLElement {
  installThemeStyles();
  setTheme(theme);
  const props = semanticProps(state);

  if (family === 'card') {
    render(
      <Card
        data-testid="representative"
        data-selected={state === 'active' ? 'true' : undefined}
        {...props}
      />,
    );
  } else if (family === 'control') {
    render(
      <Button data-testid="representative" disabled={state === 'disabled'} {...props}>
        Action
      </Button>,
    );
  } else if (family === 'navigation') {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            data-testid="representative"
            disabled={state === 'disabled'}
            aria-selected={state === 'active' ? 'true' : undefined}
            {...props}
          >
            Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  } else if (family === 'segment') {
    render(
      <Tabs value={state === 'active' ? 'one' : 'two'}>
        <TabsList>
          <TabsTrigger
            data-testid="representative"
            value="one"
            disabled={state === 'disabled'}
            {...props}
          >
            One
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
  } else if (family === 'overlay') {
    render(
      <Dialog open>
        <DialogContent data-testid="representative" {...props}>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
  } else {
    render(<div data-testid="representative" className="sto-feedback" {...props}>Feedback</div>);
  }

  return screen.getByTestId('representative');
}

const normal = (background: string, border: string, foreground: string): StateColors => ({
  background: `var(${background})`,
  border: `var(${border})`,
  foreground: `var(${foreground})`,
});

const sharedLoading = normal('--sto-loading-background', '--sto-loading-border', '--sto-loading-foreground');
const sharedError = normal(
  '--sto-feedback-error-background',
  '--sto-feedback-error-border',
  '--sto-feedback-error-foreground',
);
const sharedDisabled = normal('--sto-disabled-background', '--sto-disabled-border', '--sto-disabled-foreground');
const interactiveDisabled = normal(
  '--sto-interactive-disabled-background',
  '--sto-interactive-disabled-border',
  '--sto-interactive-disabled-foreground',
);

const expectedStates: Record<Family, Record<State, StateColors>> = {
  card: {
    default: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
    hover: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
    active: normal('--sto-control-active-bg', '--sto-border-heavy', '--sto-text-primary'),
    focus: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
    disabled: sharedDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
  control: {
    default: normal('--sto-brand-primary', '--sto-brand-primary', '--sto-control-primary-foreground'),
    hover: normal(
      '--sto-control-primary-hover-background',
      '--sto-control-primary-hover-background',
      '--sto-control-primary-foreground',
    ),
    active: normal(
      '--sto-control-primary-hover-background',
      '--sto-control-primary-hover-background',
      '--sto-control-primary-foreground',
    ),
    focus: normal('--sto-brand-primary', '--sto-brand-primary', '--sto-control-primary-foreground'),
    disabled: interactiveDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
  navigation: {
    default: normal(
      '--sto-navigation-menu-background',
      '--sto-navigation-menu-background',
      '--sto-navigation-menu-foreground',
    ),
    hover: normal(
      '--sto-navigation-menu-hover-background',
      '--sto-navigation-menu-background',
      '--sto-navigation-menu-hover-foreground',
    ),
    active: normal(
      '--sto-navigation-menu-hover-background',
      '--sto-navigation-menu-background',
      '--sto-navigation-menu-hover-foreground',
    ),
    focus: normal(
      '--sto-navigation-menu-hover-background',
      '--sto-navigation-menu-background',
      '--sto-navigation-menu-hover-foreground',
    ),
    disabled: interactiveDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
  segment: {
    default: normal('--sto-control-ghost-background', '--sto-control-ghost-background', '--sto-segment-default-foreground'),
    hover: normal('--sto-segment-hover-background', '--sto-control-ghost-background', '--sto-segment-default-foreground'),
    active: normal(
      '--sto-segment-selected-background',
      '--sto-control-ghost-background',
      '--sto-segment-selected-foreground',
    ),
    focus: normal('--sto-control-ghost-background', '--sto-control-ghost-background', '--sto-segment-default-foreground'),
    disabled: interactiveDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
  overlay: {
    default: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
    hover: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
    active: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
    focus: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
    disabled: sharedDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
  feedback: {
    default: normal(
      '--sto-feedback-info-background',
      '--sto-feedback-info-border',
      '--sto-feedback-info-foreground',
    ),
    hover: normal(
      '--sto-feedback-info-background',
      '--sto-feedback-info-border',
      '--sto-feedback-info-foreground',
    ),
    active: normal(
      '--sto-feedback-info-background',
      '--sto-feedback-info-border',
      '--sto-feedback-info-foreground',
    ),
    focus: normal(
      '--sto-feedback-info-background',
      '--sto-feedback-info-border',
      '--sto-feedback-info-foreground',
    ),
    disabled: sharedDisabled,
    loading: sharedLoading,
    error: sharedError,
  },
};

function expectColors(element: HTMLElement, expected: StateColors): void {
  const computed = getComputedStyle(element);
  expect(computed.backgroundColor).toBe(expected.background);
  let mountedBorder = computed.borderColor;
  if (!mountedBorder) {
    postcss.parse(recipesCss).walkRules((rule) => {
      if (!rule.selectors.some((selector) => {
        try {
          return element.matches(selector);
        } catch {
          return false;
        }
      })) return;
      rule.walkDecls('border-color', (declaration) => {
        mountedBorder = declaration.value;
      });
    });
  }
  expect(mountedBorder).toBe(expected.border);
  expect(computed.color).toBe(expected.foreground);
}

afterEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.stoTheme;
  document.head.querySelectorAll('style[data-theme-computed-test]').forEach((node) => node.remove());
});

describe('mounted primitive theme recipe matrix', () => {
  for (const theme of themes) {
    for (const family of families) {
      for (const state of states) {
        it(`${theme} ${family} applies semantic ${state} colors`, () => {
          const representative = mountRepresentative(family, state, theme);
          expect(representative).toHaveClass(`sto-${family === 'navigation' || family === 'segment' ? `${family}-item` : family}`);
          expectColors(representative, expectedStates[family][state]);
        });
      }
    }
  }
});

describe('Radix state and cascade combinations', () => {
  it.each(themes)('keeps open and active Radix state while aria-busy owns loading in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(
      <>
        <Tabs value="one">
          <TabsList>
            <TabsTrigger data-testid="busy-segment" value="one" aria-busy="true">One</TabsTrigger>
          </TabsList>
        </Tabs>
        <Dialog open>
          <DialogContent data-testid="busy-overlay" aria-busy="true">
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogContent>
        </Dialog>
        <DropdownMenu open>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger data-testid="busy-navigation" aria-busy="true">Sub</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>Content</DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    expect(screen.getByTestId('busy-segment')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('busy-overlay')).toHaveAttribute('data-state', 'open');
    expect(screen.getByTestId('busy-navigation')).toHaveAttribute('data-state', 'open');
    for (const testId of ['busy-segment', 'busy-overlay', 'busy-navigation']) {
      expect(getComputedStyle(screen.getByTestId(testId)).backgroundColor)
        .toBe('var(--sto-loading-background)');
    }
  });

  it.each(themes)('makes disabled win over simultaneous loading and error in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(
      <>
        <Button data-testid="disabled-control" disabled aria-busy="true" aria-invalid="true">Action</Button>
        <div
          data-testid="disabled-feedback"
          className="sto-feedback"
          aria-disabled="true"
          aria-busy="true"
          aria-invalid="true"
          data-variant="error"
        />
      </>,
    );

    expectColors(screen.getByTestId('disabled-control'), interactiveDisabled);
    expectColors(screen.getByTestId('disabled-feedback'), sharedDisabled);
  });

  it.each(themes)('preserves selected colors when card, navigation and segment receive focus in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(
      <>
        <Card data-testid="focused-card" data-selected="true" data-sto-state="focus" />
        <div
          data-testid="focused-navigation"
          className="sto-navigation-item sto-navigation-item--menu"
          aria-selected="true"
          data-sto-state="focus"
        />
        <Tabs value="one">
          <TabsList>
            <TabsTrigger data-testid="focused-segment" value="one" data-sto-state="focus">One</TabsTrigger>
          </TabsList>
        </Tabs>
      </>,
    );

    expect(getComputedStyle(screen.getByTestId('focused-card')).backgroundColor)
      .toBe('var(--sto-control-active-bg)');
    expect(getComputedStyle(screen.getByTestId('focused-navigation')).backgroundColor)
      .toBe('var(--sto-navigation-menu-hover-background)');
    expect(getComputedStyle(screen.getByTestId('focused-segment')).backgroundColor)
      .toBe('var(--sto-segment-selected-background)');
  });
});

describe('disabled behavior', () => {
  it.each([true, 'true'] as const)('prevents activation for an asChild Button disabled by %s', (disabledValue) => {
    const onClick = vi.fn();
    render(
      <Button asChild disabled={disabledValue === true} aria-disabled={disabledValue === 'true' ? 'true' : undefined}>
        <a href="/unsafe" onClick={onClick}>Unsafe action</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Unsafe action' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('tabindex', '-1');
    expect(link).not.toHaveAttribute('disabled');
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});
