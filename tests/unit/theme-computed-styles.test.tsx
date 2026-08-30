import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import postcss from 'postcss';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { InputComposerSendButton } from '@/components/input-composer/input-composer-send-button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');
const moreAppsCss = read('src/components/more-apps/more-apps.css');
const workflowCanvasCss = read('src/pages/WorkflowDesigner/workflow-designer-canvas.css');
const inputSource = read('src/components/ui/input.tsx');
const textareaSource = read('src/components/ui/textarea.tsx');
const states = ['default', 'hover', 'active', 'focus', 'disabled', 'loading', 'error'] as const;
const themes = ['light', 'dark'] as const;
const primitives = [
  'Button',
  'Card',
  'Input',
  'Textarea',
  'Select',
  'Tabs',
  'Dialog',
  'Dropdown',
  'Tooltip',
] as const;
const primitiveStates: Record<(typeof primitives)[number], readonly State[]> = {
  Button: states,
  Card: states,
  Input: states,
  Textarea: states,
  Select: states,
  Tabs: states,
  Dialog: states,
  Dropdown: states,
  Tooltip: states,
};

type State = (typeof states)[number];
type Theme = (typeof themes)[number];
type Primitive = (typeof primitives)[number];
type SemanticProps = Record<string, string | boolean | undefined>;
type StateColors = { background: string; border: string; foreground: string };

function flattenLayer(css: string): string {
  const root = postcss.parse(css);
  const layer = root.nodes.find(
    (node): node is postcss.AtRule => node.type === 'atrule' && node.name === 'layer',
  );
  return (layer?.nodes ?? root.nodes).map((node) => node.toString()).join('\n');
}

function colorMarker(token: string): string {
  let hash = 17;
  for (const character of token) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const red = 32 + (hash % 192);
  const green = 32 + ((hash >>> 8) % 192);
  const blue = 32 + ((hash >>> 16) % 192);
  return `rgb(${red}, ${green}, ${blue})`;
}

function tokenMarker(token: string): string {
  if (token.includes('arrow') && token.endsWith('-image')) {
    return `url("sto-marker://${token.slice(2)}")`;
  }
  if (token.includes('shadow')) return `0 0 0 3px ${colorMarker(token)}`;
  if (token.includes('backdrop-filter')) return 'none';
  return colorMarker(token);
}

function markerRecipes(css: string): string {
  return css.replace(/var\((--sto-[\w-]+)\)/g, (_match, token: string) => tokenMarker(token));
}

function installThemeStyles(targetDocument = document): void {
  if (targetDocument.head.querySelector('style[data-theme-computed-test]')) return;
  const style = targetDocument.createElement('style');
  style.dataset.themeComputedTest = '';
  style.textContent = `${markerRecipes(flattenLayer(recipesCss))}\n:is(.sto-card,.sto-control,.sto-navigation-item,.sto-segment-item,.sto-overlay,.sto-feedback){border-style:solid;border-width:1px}`;
  targetDocument.head.append(style);
}

function resolveThemeToken(token: string, theme: Theme): string {
  const declarations = new Map<string, string>();
  const root = postcss.parse(flattenLayer(tokensCss));
  root.walkRules((rule) => {
    const isBase = rule.selector.split(',').some((selector) => selector.trim() === ':root');
    const isDark = rule.selector.split(',').some((selector) => selector.trim() === '.dark');
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

function installExactThemeStylesForTheme(theme: Theme, targetDocument = document): void {
  const tokens = [
    '--sto-overlay-menu-border',
    '--sto-overlay-content-border',
    '--sto-overlay-background',
    '--sto-overlay-border',
    '--sto-overlay-foreground',
    '--sto-composer-send-background',
    '--sto-composer-send-border',
    '--sto-composer-send-foreground',
    '--sto-composer-send-hover-background',
    '--sto-composer-stop-background',
    '--sto-composer-stop-border',
    '--sto-composer-stop-foreground',
    '--sto-composer-stop-hover-background',
    '--sto-composer-unavailable-background',
    '--sto-composer-unavailable-border',
    '--sto-composer-unavailable-foreground',
    '--sto-shadow-brand-action',
    '--sto-control-focus-shadow',
    '--sto-navigation-picker-hover-background',
    '--sto-navigation-selected-hover-background',
    '--sto-navigation-collapsed-background',
    '--sto-navigation-collapsed-foreground',
    '--sto-navigation-collapsed-hover-background',
    '--sto-navigation-collapsed-selected-background',
    '--sto-navigation-collapsed-selected-foreground',
    '--sto-navigation-collapsed-selected-shadow',
  ];
  const style = targetDocument.createElement('style');
  style.textContent = tokens.reduce(
    (css, token) => css.replaceAll(`var(${token})`, resolveThemeToken(token, theme)),
    flattenLayer(recipesCss),
  );
  targetDocument.head.append(style);
}

function createExactThemeRoot(theme: Theme): {
  container: HTMLElement;
  dispose: () => void;
} {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error('Expected iframe document for exact theme test');
  installExactThemeStylesForTheme(theme, frameDocument);
  setTheme(theme, frameDocument);
  const container = frameDocument.createElement('div');
  frameDocument.body.append(container);
  return { container, dispose: () => frame.remove() };
}

function createAppCardCascadeRoot(theme: Theme): {
  container: HTMLElement;
  dispose: () => void;
} {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error('Expected iframe document for app card cascade test');
  const style = frameDocument.createElement('style');
  style.textContent = `${markerRecipes(flattenLayer(recipesCss))}\n${moreAppsCss}`;
  frameDocument.head.append(style);
  setTheme(theme, frameDocument);
  const container = frameDocument.createElement('div');
  container.className = 'page-more-apps';
  frameDocument.body.append(container);
  return { container, dispose: () => frame.remove() };
}

function createFeatureCascadeRoot(theme: Theme, featureCss: string, rootClass: string): {
  container: HTMLElement;
  dispose: () => void;
} {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error('Expected iframe document for feature cascade test');
  const style = frameDocument.createElement('style');
  style.textContent = `${markerRecipes(flattenLayer(recipesCss))}\n${markerRecipes(featureCss)}`;
  frameDocument.head.append(style);
  setTheme(theme, frameDocument);
  const container = frameDocument.createElement('div');
  container.className = rootClass;
  frameDocument.body.append(container);
  return { container, dispose: () => frame.remove() };
}

function setTheme(theme: Theme, targetDocument = document): void {
  targetDocument.documentElement.className = theme === 'dark' ? 'dark' : '';
  targetDocument.documentElement.dataset.stoTheme = theme;
}

function createIsolatedThemeRoot(theme: Theme): {
  container: HTMLElement;
  dispose: () => void;
} {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error('Expected iframe document for isolated cascade test');
  installThemeStyles(frameDocument);
  setTheme(theme, frameDocument);
  const container = frameDocument.createElement('div');
  frameDocument.body.append(container);
  return { container, dispose: () => frame.remove() };
}

function semanticProps(state: State): SemanticProps {
  return {
    'data-sto-state': ['hover', 'active', 'focus'].includes(state) ? state : undefined,
    'aria-disabled': state === 'disabled' ? 'true' : undefined,
    'aria-busy': state === 'loading' ? 'true' : undefined,
    'aria-invalid': state === 'error' ? 'true' : undefined,
  };
}

function mountPrimitive(primitive: Primitive, state: State, theme: Theme): HTMLElement {
  installThemeStyles();
  setTheme(theme);
  const props = semanticProps(state);
  const disabled = state === 'disabled';
  const markerClass = `marker-${theme}-${primitive.toLowerCase()}-${state}`;

  if (primitive === 'Button') {
    render(<Button data-testid="primitive" className={markerClass} disabled={disabled} {...props}>Action</Button>);
  } else if (primitive === 'Card') {
    render(
      <Card
        data-testid="primitive"
        className={markerClass}
        data-selected={state === 'active' ? 'true' : undefined}
        {...props}
      />,
    );
  } else if (primitive === 'Input') {
    render(<Input data-testid="primitive" className={markerClass} disabled={disabled} placeholder="Input" {...props} />);
  } else if (primitive === 'Textarea') {
    render(<Textarea data-testid="primitive" className={markerClass} disabled={disabled} placeholder="Textarea" {...props} />);
  } else if (primitive === 'Select') {
    render(
      <Select data-testid="primitive" className={markerClass} disabled={disabled} {...props}>
        <option>Option</option>
      </Select>,
    );
  } else if (primitive === 'Tabs') {
    render(
      <Tabs value={state === 'active' ? 'one' : 'two'}>
        <TabsList>
          <TabsTrigger data-testid="primitive" className={markerClass} value="one" disabled={disabled} {...props}>
            One
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
  } else if (primitive === 'Dialog') {
    render(
      <Dialog open>
        <DialogContent data-testid="primitive" className={markerClass} {...props}>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
  } else if (primitive === 'Dropdown') {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            data-testid="primitive"
            className={markerClass}
            disabled={disabled}
            aria-selected={state === 'active' ? 'true' : undefined}
            {...props}
          >
            Item
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  } else {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent data-testid="primitive" className={markerClass} {...props}>Tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
  }

  return screen.getByTestId('primitive');
}

const normal = (background: string, border: string, foreground: string): StateColors => ({
  background,
  border,
  foreground,
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

const cardStates: Record<State, StateColors> = {
  default: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
  hover: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
  active: normal('--sto-control-active-bg', '--sto-border-heavy', '--sto-text-primary'),
  focus: normal('--sto-card-default-background', '--sto-card-default-border', '--sto-card-default-foreground'),
  disabled: sharedDisabled,
  loading: sharedLoading,
  error: sharedError,
};

const primaryControlStates: Record<State, StateColors> = {
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
};

const fieldStates: Record<State, StateColors> = {
  default: normal('--sto-control-field-background', '--sto-control-field-border', '--sto-control-field-foreground'),
  hover: normal('--sto-control-field-background', '--sto-control-field-border', '--sto-control-field-foreground'),
  active: normal('--sto-control-field-background', '--sto-control-field-border', '--sto-control-field-foreground'),
  focus: normal('--sto-control-field-background', '--sto-control-field-border', '--sto-control-field-foreground'),
  disabled: interactiveDisabled,
  loading: sharedLoading,
  error: sharedError,
};

const navigationStates: Record<State, StateColors> = {
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
};

const segmentStates: Record<State, StateColors> = {
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
};

const overlayStates: Record<State, StateColors> = {
  default: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
  hover: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
  active: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
  focus: normal('--sto-overlay-background', '--sto-overlay-border', '--sto-overlay-foreground'),
  disabled: sharedDisabled,
  loading: sharedLoading,
  error: sharedError,
};

const expectedByPrimitive: Record<Primitive, Record<State, StateColors>> = {
  Button: primaryControlStates,
  Card: cardStates,
  Input: fieldStates,
  Textarea: fieldStates,
  Select: fieldStates,
  Tabs: segmentStates,
  Dialog: overlayStates,
  Dropdown: navigationStates,
  Tooltip: overlayStates,
};

function expectColors(element: HTMLElement, expected: StateColors): void {
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!computed) throw new Error('Expected mounted element to have a computed style view');
  expect(computed.backgroundColor).toBe(colorMarker(expected.background));
  expect(computed.borderColor).toBe(colorMarker(expected.border));
  expect(computed.color).toBe(colorMarker(expected.foreground));
}

afterEach(() => {
  document.documentElement.className = '';
  delete document.documentElement.dataset.stoTheme;
});

afterAll(() => {
  document.head.querySelectorAll('style[data-theme-computed-test]').forEach((node) => node.remove());
});

describe('mounted primitive theme recipe matrix', () => {
  for (const theme of themes) {
    for (const primitive of primitives) {
      for (const state of primitiveStates[primitive]) {
        it(`${theme} ${primitive} applies semantic ${state} colors`, () => {
          const mounted = mountPrimitive(primitive, state, theme);
          expectColors(mounted, expectedByPrimitive[primitive][state]);
          if (state === 'focus' && primitive === 'Card') {
            expect(getComputedStyle(mounted).boxShadow)
              .toContain(colorMarker('--sto-card-focus-shadow'));
          } else if (
            state === 'focus'
            && ['Button', 'Input', 'Textarea', 'Select', 'Tabs'].includes(primitive)
          ) {
            expect(getComputedStyle(mounted).boxShadow)
              .toContain(colorMarker('--sto-control-focus-shadow'));
          }
        });
      }
    }
  }

  it.each(themes)('mounts Feedback across every semantic state in %s', (theme) => {
    const feedbackStates: Record<State, StateColors> = {
      default: normal('--sto-feedback-info-background', '--sto-feedback-info-border', '--sto-feedback-info-foreground'),
      hover: normal('--sto-feedback-info-background', '--sto-feedback-info-border', '--sto-feedback-info-foreground'),
      active: normal('--sto-feedback-info-background', '--sto-feedback-info-border', '--sto-feedback-info-foreground'),
      focus: normal('--sto-feedback-info-background', '--sto-feedback-info-border', '--sto-feedback-info-foreground'),
      disabled: sharedDisabled,
      loading: sharedLoading,
      error: sharedError,
    };

    for (const state of states) {
      installThemeStyles();
      setTheme(theme);
      const { unmount } = render(
        <div data-testid={`feedback-${state}`} className="sto-feedback" {...semanticProps(state)} />,
      );
      const feedback = screen.getByTestId(`feedback-${state}`);
      expectColors(feedback, feedbackStates[state]);
      if (state === 'focus') {
        expect(getComputedStyle(feedback).boxShadow)
          .toContain(colorMarker('--sto-control-focus-shadow'));
      }
      unmount();
    }
  });
});

describe('overlay border variants', () => {
  it.each([
    ['light', 'sto-overlay--menu-border', 'rgb(229, 230, 235)'],
    ['light', 'sto-overlay--content-border', 'rgb(232, 234, 239)'],
    ['dark', 'sto-overlay--menu-border', 'rgba(255, 255, 255, 0.08)'],
    ['dark', 'sto-overlay--content-border', 'rgba(255, 255, 255, 0.08)'],
  ] as const)('preserves the %s %s border across interactive states', (theme, modifier, expected) => {
    for (const state of ['default', 'hover', 'active', 'focus'] as const) {
      const { container, dispose } = createExactThemeRoot(theme);
      const overlay = container.ownerDocument.createElement('div');
      overlay.className = `sto-overlay ${modifier}`;
      if (state !== 'default') overlay.dataset.stoState = state;
      container.append(overlay);
      const reference = container.ownerDocument.createElement('div');
      reference.className = 'sto-overlay';
      if (state !== 'default') reference.dataset.stoState = state;
      container.append(reference);
      const computed = container.ownerDocument.defaultView!.getComputedStyle(overlay);
      const shared = container.ownerDocument.defaultView!.getComputedStyle(reference);
      expect(computed.borderColor).toBe(expected);
      expect(computed.backgroundColor).toBe(shared.backgroundColor);
      expect(computed.color).toBe(shared.color);
      expect(computed.boxShadow).toBe(shared.boxShadow);
      expect(computed.outlineStyle).toBe(shared.outlineStyle);
      dispose();
    }
  });
});

type ComposerActionState = 'send' | 'queued-send' | 'stop' | 'disabled-stop' | 'unavailable';

function mountComposerAction(
  theme: Theme,
  state: ComposerActionState,
  interaction: 'default' | 'hover' | 'focus',
): {
  action: HTMLButtonElement;
  dispose: () => void;
} {
  const { container, dispose } = createExactThemeRoot(theme);
  const mounted = render(
    <InputComposerSendButton
      sending={state === 'queued-send' || state === 'stop' || state === 'disabled-stop'}
      canSend={state === 'send' || state === 'queued-send'}
      canStop={state === 'stop'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      sendTitle="Send"
      stopTitle="Stop"
    />,
    { container },
  );
  const action = mounted.getByRole('button');
  if (interaction === 'hover') action.dataset.stoState = 'hover';
  if (interaction === 'focus') action.dataset.stoState = 'focus';
  return {
    action,
    dispose: () => {
      mounted.unmount();
      dispose();
    },
  };
}

describe('composer action recipe cascade', () => {
  it.each([
    ['light', 'send', 'default', 'rgb(255, 111, 0)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['light', 'queued-send', 'hover', 'rgba(255, 111, 0, 0.9)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['light', 'send', 'focus', 'rgb(255, 111, 0)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['light', 'stop', 'default', 'rgb(15, 23, 42)', 'rgb(15, 23, 42)', 'rgb(255, 255, 255)'],
    ['light', 'stop', 'hover', 'rgb(30, 41, 59)', 'rgb(15, 23, 42)', 'rgb(255, 255, 255)'],
    ['light', 'stop', 'focus', 'rgb(15, 23, 42)', 'rgb(15, 23, 42)', 'rgb(255, 255, 255)'],
    ['light', 'disabled-stop', 'default', 'rgb(15, 23, 42)', 'rgb(15, 23, 42)', 'rgb(255, 255, 255)'],
    ['light', 'unavailable', 'default', 'rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.08)', 'rgba(99, 112, 131, 0.55)'],
    ['dark', 'send', 'default', 'rgb(255, 111, 0)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['dark', 'queued-send', 'hover', 'rgba(255, 111, 0, 0.9)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['dark', 'send', 'focus', 'rgb(255, 111, 0)', 'rgba(255, 111, 0, 0.8)', 'rgb(255, 255, 255)'],
    ['dark', 'stop', 'default', 'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.8)', 'rgb(15, 23, 42)'],
    ['dark', 'stop', 'hover', 'rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.8)', 'rgb(15, 23, 42)'],
    ['dark', 'stop', 'focus', 'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.8)', 'rgb(15, 23, 42)'],
    ['dark', 'disabled-stop', 'default', 'rgba(255, 255, 255, 0.8)', 'rgba(255, 255, 255, 0.8)', 'rgb(15, 23, 42)'],
    ['dark', 'unavailable', 'default', 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.1)', 'rgba(179, 179, 179, 0.55)'],
  ] as const)(
    '%s %s %s keeps approved action pixels',
    (theme, state, interaction, background, border, foreground) => {
      const { action, dispose } = mountComposerAction(theme, state, interaction);
      const computed = getComputedStyle(action);
      expect(computed.backgroundColor).toBe(background);
      expect(computed.borderColor).toBe(border);
      expect(computed.color).toBe(foreground);
      expect(getComputedStyle(action.querySelector('svg')!).color).toBe(foreground);
      if (interaction === 'focus') {
        expect(computed.boxShadow).toBe(resolveThemeToken('--sto-control-focus-shadow', theme));
      }
      dispose();
    },
  );
});

describe('card cascade combinations', () => {
  it('keeps card state selectors specificity-neutral', () => {
    expect(recipesCss).not.toContain('.sto-card:not(.sto-card--flat):not(.sto-card-flat)');
    expect(recipesCss).toContain(
      ".sto-card:where(.sto-card--flat.sto-card--interactive):where(:hover, [data-sto-state='hover'])",
    );
    expect(recipesCss).toContain(
      ".sto-card:where(:focus-visible, :has(:focus-visible), [data-sto-state='focus'])",
    );
  });

  it.each(themes)('makes disabled win over hover in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(<Card data-testid="card" data-sto-state="hover" aria-disabled="true" />);
    expectColors(screen.getByTestId('card'), sharedDisabled);
  });

  it.each(themes)('makes selected win over hover in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(<Card data-testid="card" data-sto-state="hover" data-selected="true" />);
    expectColors(screen.getByTestId('card'), cardStates.active);
  });

  it.each(themes)('preserves the secondary variant during hover in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(<Card data-testid="card" className="sto-card--secondary" data-sto-state="hover" />);
    expectColors(
      screen.getByTestId('card'),
      normal('--sto-surface-secondary', '--sto-border-default', '--sto-card-default-foreground'),
    );
  });

  it.each(themes)('keeps flat hover surface and focus ring together in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(
      <Card
        data-testid="card"
        className="sto-card--flat sto-card--interactive"
        data-sto-state="hover"
      >
        <button type="button">Focus target</button>
      </Card>,
    );
    screen.getByRole('button', { name: 'Focus target' }).focus();

    const card = screen.getByTestId('card');
    const computed = getComputedStyle(card);
    expect(computed.backgroundColor).toBe(colorMarker('--sto-card-flat-hover-bg'));
    expect(computed.borderColor).toBe(colorMarker('--sto-card-flat-hover-border'));
    expect(card.matches(
      ".sto-card:where(.sto-card--flat.sto-card--interactive):where([data-sto-state='hover'])",
    )).toBe(true);
    expect(card.matches('.sto-card:where(:has(:focus-visible))')).toBe(true);
    expect(recipesCss.indexOf('box-shadow: var(--sto-card-focus-shadow)'))
      .toBeGreaterThan(recipesCss.indexOf('box-shadow: var(--sto-card-flat-hover-shadow)'));
  });

  it.each(themes)('keeps shared recipe colors above App card geometry CSS in %s', (theme) => {
    const stateExpectations = {
      default: normal('--sto-card-flat-bg', '--sto-card-flat-border', '--sto-card-default-foreground'),
      hover: normal('--sto-card-flat-hover-bg', '--sto-card-flat-hover-border', '--sto-card-default-foreground'),
      focus: normal('--sto-card-flat-bg', '--sto-card-flat-border', '--sto-card-default-foreground'),
      selected: normal('--sto-control-active-bg', '--sto-border-heavy', '--sto-text-primary'),
    } as const;

    for (const [familyClass, borderWidth, borderRadius] of [
      ['app-market__row', '0.8px', '18px'],
      ['more-apps-card', '1px', '14px'],
    ] as const) {
      for (const [state, expected] of Object.entries(stateExpectations)) {
        const { container, dispose } = createAppCardCascadeRoot(theme);
        const result = render(
          <article
            data-testid="app-card"
            className={`sto-card sto-card--flat sto-card--interactive ${familyClass}`}
            data-sto-state={state === 'hover' || state === 'focus' ? state : undefined}
            data-selected={state === 'selected' ? 'true' : undefined}
          />,
          { container },
        );
        const card = result.getByTestId('app-card');
        expectColors(card, expected);
        expect(getComputedStyle(card).borderTopWidth).toBe(borderWidth);
        expect(getComputedStyle(card).borderRadius).toBe(borderRadius);
        if (state === 'focus') {
          expect(getComputedStyle(card).boxShadow)
            .toContain(colorMarker('--sto-card-focus-shadow'));
        }
        result.unmount();
        dispose();
      }
    }
  });

  it.each(themes)('keeps App preview art internally fixed in %s', (theme) => {
    const { container, dispose } = createFeatureCascadeRoot(theme, moreAppsCss, 'page-more-apps');
    const result = render(
      <div>
        <div data-testid="preview" className="app-market__hero-preview">
          <strong data-testid="preview-title" className="app-market__hero-preview-title">Preview</strong>
          <div className="app-market__hero-stat">
            <em data-testid="preview-caption">Caption</em>
            <strong data-testid="preview-value">Value</strong>
          </div>
        </div>
      </div>,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('preview-title')).color)
      .toBe(colorMarker('--sto-art-app-plaza-preview-foreground'));
    expect(getComputedStyle(result.getByTestId('preview-caption')).color)
      .toBe(colorMarker('--sto-art-app-plaza-preview-muted-foreground'));
    expect(getComputedStyle(result.getByTestId('preview-value')).color)
      .toBe(colorMarker('--sto-art-app-plaza-preview-foreground'));
    result.unmount();
    dispose();
  });

  it.each(themes)('keeps Workflow node swatches paired with fixed authored foregrounds in %s', (theme) => {
    const { container, dispose } = createFeatureCascadeRoot(
      theme,
      workflowCanvasCss,
      'workflow-designer-flow',
    );
    const result = render(
      <div>
        <span data-testid="node-icon" className="wf-canvas-node-icon accent-trigger" />
        <span data-testid="library-icon" className="workflow-node-library-icon" />
        <span className="tile-output">
          <span data-testid="output-icon" className="template-tile-icon" />
        </span>
      </div>,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('node-icon')).color)
      .toBe(colorMarker('--sto-art-workflow-node-icon-foreground'));
    expect(getComputedStyle(result.getByTestId('library-icon')).color)
      .toBe(colorMarker('--sto-art-workflow-node-icon-foreground'));
    expect(getComputedStyle(result.getByTestId('output-icon')).color)
      .toBe(colorMarker('--sto-art-workflow-template-output-foreground'));

    result.unmount();
    dispose();
  });

  it.each(themes)('resolves Workflow shared interaction recipes in combined states in %s', (theme) => {
    const { container, dispose } = createFeatureCascadeRoot(
      theme,
      workflowCanvasCss,
      'workflow-designer-flow',
    );
    const result = render(
      <div>
        <button data-testid="prompt-hover" data-sto-state="hover" className="sto-control sto-control--compact-action wf-canvas-node-prompt-button" />
        <input data-testid="field-focus" data-sto-state="focus" className="sto-control sto-control--compact-field" />
        <div data-testid="popover" className="sto-overlay sto-overlay--selection-popover insert-node-popover" />
        <button data-testid="dismiss-hover" data-sto-state="hover" className="sto-control sto-control--dismiss insert-node-popover-close" />
        <button data-testid="option-hover" data-sto-state="hover" className="sto-card sto-card--selection-option template-tile" />
        <button data-testid="library-item" className="sto-control sto-control--library-item workflow-node-library-item" />
      </div>,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('prompt-hover')).backgroundColor)
      .toBe(colorMarker('--sto-feature-hover-background'));
    expect(getComputedStyle(result.getByTestId('field-focus')).borderColor)
      .toBe(colorMarker('--sto-feature-brand-accent'));
    expect(getComputedStyle(result.getByTestId('popover')).backgroundColor)
      .toBe(colorMarker('--sto-overlay-background'));
    expect(getComputedStyle(result.getByTestId('dismiss-hover')).color)
      .toBe(colorMarker('--sto-feature-foreground-deep'));
    expect(getComputedStyle(result.getByTestId('option-hover')).backgroundColor)
      .toBe(colorMarker('--sto-feature-warning-background'));
    expect(getComputedStyle(result.getByTestId('option-hover')).boxShadow).toBe('none');
    expect(getComputedStyle(result.getByTestId('library-item')).color)
      .toBe(colorMarker('--sto-feature-foreground-strong'));

    result.unmount();
    dispose();
  });

  it.each(themes)('resolves More Apps shared default hover focus and disabled states in %s', (theme) => {
    const { container, dispose } = createFeatureCascadeRoot(theme, moreAppsCss, 'page-more-apps');
    const result = render(
      <div>
        <button data-testid="art-focus" data-sto-state="focus" className="sto-control sto-control--artwork-link app-market__hero-banner--clickable" />
        <button data-testid="filter-active-hover" data-sto-state="hover" aria-pressed="true" className="sto-navigation-item sto-navigation-item--feature-filter app-market__cat" />
        <button data-testid="icon-default" className="sto-control sto-control--icon-muted more-apps-card__icon-btn" />
        <button data-testid="favorite-default" className="sto-control sto-control--favorite sto-control--favorite-subtle more-apps-card__favorite" />
        <button data-testid="icon-hover" data-sto-state="hover" className="sto-control sto-control--icon-muted more-apps-card__icon-btn" />
        <button data-testid="icon-danger-hover" data-sto-state="hover" className="sto-control sto-control--icon-muted sto-control--icon-danger more-apps-card__icon-btn" />
        <input data-testid="dialog-field-focus" data-sto-state="focus" className="sto-control sto-control--dialog-field more-apps-modal__input" />
        <button data-testid="dialog-secondary-hover" data-sto-state="hover" className="sto-control sto-control--dialog-secondary more-apps-modal__btn" />
        <button data-testid="dialog-primary-hover" data-sto-state="hover" className="sto-control sto-control--dialog-primary more-apps-modal__btn" />
        <button data-testid="quiet-disabled-hover" data-sto-state="hover" disabled className="sto-control sto-control--quiet app-market__load-more" />
      </div>,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('art-focus')).outlineOffset).toBe('2px');
    expect(getComputedStyle(result.getByTestId('filter-active-hover')).backgroundColor)
      .toBe(colorMarker('--sto-control-active-bg'));
    expect(getComputedStyle(result.getByTestId('filter-active-hover')).color)
      .toBe(colorMarker('--sto-quick-input-content-foreground'));
    expect(getComputedStyle(result.getByTestId('icon-default')).color)
      .toBe(colorMarker('--sto-feature-muted-foreground'));
    expect(getComputedStyle(result.getByTestId('favorite-default')).color)
      .toBe(colorMarker('--sto-icon-quaternary'));
    expect(getComputedStyle(result.getByTestId('icon-hover')).color)
      .toBe(colorMarker('--sto-feature-hover-foreground'));
    expect(getComputedStyle(result.getByTestId('icon-danger-hover')).color)
      .toBe(colorMarker('--sto-danger-primary'));
    expect(getComputedStyle(result.getByTestId('dialog-field-focus')).borderColor)
      .toBe(colorMarker('--sto-brand-primary'));
    expect(getComputedStyle(result.getByTestId('dialog-secondary-hover')).backgroundColor)
      .toBe(colorMarker('--sto-disabled-background'));
    expect(getComputedStyle(result.getByTestId('dialog-primary-hover')).filter)
      .toBe('brightness(1.05)');
    expect(getComputedStyle(result.getByTestId('quiet-disabled-hover')).color)
      .toBe(colorMarker('--sto-text-tertiary'));

    result.unmount();
    dispose();
  });

  it.each(themes)('resolves the active feature-filter count from the shared recipe in %s', (theme) => {
    const { container, dispose } = createFeatureCascadeRoot(theme, '', 'page-more-apps');
    const result = render(
      <button aria-pressed="true" className="sto-navigation-item sto-navigation-item--feature-filter">
        <span data-testid="active-filter-count" className="sto-navigation-item__count">1</span>
      </button>,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('active-filter-count')).color)
      .toBe(colorMarker('--sto-markdown-code-muted'));

    result.unmount();
    dispose();
  });
});

describe('Navigation consumer pixel modifiers', () => {
  it.each([
    ['light', 'rgb(240, 242, 245)'],
    ['dark', 'rgba(255, 255, 255, 0.06)'],
  ] as const)('preserves the %s picker hover background', (theme, expected) => {
    const { container, dispose } = createExactThemeRoot(theme);
    const result = render(
      <button
        data-testid="picker-row"
        className="sto-navigation-item sto-navigation-item--picker"
        data-sto-state="hover"
      />,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('picker-row')).backgroundColor).toBe(expected);
    result.unmount();
    dispose();
  });

  it.each([
    ['light', 'rgb(228, 228, 228)'],
    ['dark', 'rgb(40, 40, 40)'],
  ] as const)('preserves the %s selected session hover background', (theme, expected) => {
    const { container, dispose } = createExactThemeRoot(theme);
    const result = render(
      <div
        data-testid="session-row"
        className="sto-navigation-item sto-navigation-item--session"
        data-selected="true"
        data-sto-state="hover"
      />,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('session-row')).backgroundColor).toBe(expected);
    result.unmount();
    dispose();
  });

  it.each([
    ['light', 'rgba(0, 0, 0, 0.06)'],
    ['dark', 'rgba(255, 255, 255, 0.08)'],
  ] as const)('preserves the %s collapsed navigation hover background', (theme, expected) => {
    const { container, dispose } = createExactThemeRoot(theme);
    const result = render(
      <a
        data-testid="collapsed-row"
        className="sto-navigation-item sto-navigation-item--collapsed"
        data-sto-state="hover"
      />,
      { container },
    );

    expect(getComputedStyle(result.getByTestId('collapsed-row')).backgroundColor).toBe(expected);
    result.unmount();
    dispose();
  });

  it.each([
    ['light', 'hover', 'rgba(0, 0, 0, 0.06)', 'rgb(122, 132, 148)'],
    ['light', 'focus-visible', 'rgba(0, 0, 0, 0.06)', 'rgb(122, 132, 148)'],
    ['dark', 'hover', 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.5)'],
    ['dark', 'focus-visible', 'rgba(255, 255, 255, 0.08)', 'rgba(255, 255, 255, 0.5)'],
  ] as const)(
    'preserves the %s inactive collapsed %s background and foreground',
    (theme, state, background, foreground) => {
      const { container, dispose } = createExactThemeRoot(theme);
      const result = render(
        <a
          href="/inactive"
          data-testid="collapsed-combined-state"
          className="sto-navigation-item sto-navigation-item--collapsed"
          data-sto-state={state === 'hover' ? 'hover' : undefined}
        />,
        { container },
      );
      const row = result.getByTestId('collapsed-combined-state');
      if (state === 'focus-visible') {
        row.focus();
        expect(row.matches(':focus-visible')).toBe(true);
      }
      const computed = getComputedStyle(row);
      expect(computed.backgroundColor).toBe(background);
      expect(computed.color).toBe(foreground);
      result.unmount();
      dispose();
    },
  );

  it.each([
    ['light', 'rgba(0, 0, 0, 0)', 'rgb(122, 132, 148)'],
    ['dark', 'rgba(0, 0, 0, 0)', 'rgba(255, 255, 255, 0.5)'],
  ] as const)('preserves the %s collapsed navigation default pixels', (theme, background, foreground) => {
    const { container, dispose } = createExactThemeRoot(theme);
    const result = render(
      <a data-testid="collapsed-default" className="sto-navigation-item sto-navigation-item--collapsed" />,
      { container },
    );
    const computed = getComputedStyle(result.getByTestId('collapsed-default'));
    expect(computed.backgroundColor).toBe(background);
    expect(computed.color).toBe(foreground);
    result.unmount();
    dispose();
  });

  it.each(themes)('preserves the %s collapsed navigation selected pixels', (theme) => {
    const { container, dispose } = createExactThemeRoot(theme);
    const result = render(
      <a
        data-testid="collapsed-selected"
        className="sto-navigation-item sto-navigation-item--collapsed"
        aria-current="page"
      />,
      { container },
    );
    const computed = getComputedStyle(result.getByTestId('collapsed-selected'));
    expect(computed.backgroundColor).toBe('rgb(255, 111, 0)');
    expect(computed.color).toBe('rgb(255, 255, 255)');
    result.unmount();
    dispose();
  });
});

describe('disabled field pixels', () => {
  it.each(themes)('switches the mounted Select arrow to its disabled semantic image in %s', (theme) => {
    installThemeStyles();
    setTheme(theme);
    render(
      <>
        <Select data-testid="normal-select"><option>Normal</option></Select>
        <Select data-testid="disabled-select" disabled><option>Disabled</option></Select>
      </>,
    );

    expect(getComputedStyle(screen.getByTestId('normal-select')).backgroundImage)
      .toContain('sto-control-select-arrow-image');
    expect(getComputedStyle(screen.getByTestId('disabled-select')).backgroundImage)
      .toContain('sto-control-select-arrow-disabled-image');
  });

  it('owns disabled placeholder and select arrow appearance in theme source', () => {
    expect(tokensCss).toContain('--sto-control-disabled-placeholder:');
    expect(tokensCss).toContain('--sto-control-select-arrow-image:');
    expect(tokensCss).toContain('--sto-control-select-arrow-disabled-image:');
    expect(recipesCss).toMatch(/\.sto-control[^{}]+:disabled[^{}]+::placeholder/);
    expect(recipesCss).toMatch(/\.sto-control--field::placeholder\s*\{[^}]*--sto-control-placeholder/);
    expect(inputSource).not.toContain('placeholder:text-');
    expect(textareaSource).not.toContain('placeholder:text-');
    expect(recipesCss).toMatch(/\.sto-control--select\s*\{[^}]*background-image:\s*var\(--sto-control-select-arrow-image\)/);
    expect(recipesCss).toMatch(/\.sto-control--select:disabled,[^}]+background-image:\s*var\(--sto-control-select-arrow-disabled-image\)/);
  });
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
        .toBe(colorMarker('--sto-loading-background'));
    }
  });

  it.each(themes)('makes disabled win over simultaneous loading and error in %s', (theme) => {
    const { container, dispose } = createIsolatedThemeRoot(theme);
    const mounted = render(
      <>
        <Button
          data-testid="disabled-control"
          className="marker-combination-disabled-control"
          disabled
          aria-busy="true"
          aria-invalid="true"
        >Action</Button>
        <div
          data-testid="disabled-feedback"
          className="sto-feedback marker-combination-disabled-feedback"
          aria-disabled="true"
          aria-busy="true"
          aria-invalid="true"
          data-variant="error"
        />
      </>,
      { container },
    );

    expectColors(mounted.getByTestId('disabled-control'), interactiveDisabled);
    expectColors(mounted.getByTestId('disabled-feedback'), sharedDisabled);
    mounted.unmount();
    dispose();
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
      .toBe(colorMarker('--sto-control-active-bg'));
    expect(getComputedStyle(screen.getByTestId('focused-card')).boxShadow)
      .toContain(colorMarker('--sto-card-focus-shadow'));
    expect(getComputedStyle(screen.getByTestId('focused-navigation')).backgroundColor)
      .toBe(colorMarker('--sto-navigation-menu-hover-background'));
    expect(getComputedStyle(screen.getByTestId('focused-segment')).backgroundColor)
      .toBe(colorMarker('--sto-segment-selected-background'));
    expect(getComputedStyle(screen.getByTestId('focused-segment')).boxShadow)
      .toContain(colorMarker('--sto-control-focus-shadow'));
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
