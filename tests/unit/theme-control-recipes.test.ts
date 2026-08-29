import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const recipes = read('src/styles/theme/recipes.css');
const tokens = read('src/styles/theme/tokens.css');

const primitiveFiles = [
  'src/components/ui/button.tsx',
  'src/components/ui/input.tsx',
  'src/components/ui/textarea.tsx',
  'src/components/ui/tabs.tsx',
  'src/components/ui/select.tsx',
  'src/components/ui/dialog.tsx',
  'src/components/ui/dropdown-menu.tsx',
  'src/components/ui/tooltip.tsx',
] as const;

describe('semantic control and overlay recipes', () => {
  it('defines complete semantic state chains for every shared recipe family', () => {
    for (const family of [
      'control',
      'navigation-item',
      'segment-item',
      'overlay',
      'feedback',
    ]) {
      expect(recipes).toContain(`.sto-${family}`);
    }

    expect(recipes).toContain('.sto-control:is(:focus-visible');
    expect(recipes).toContain(':is(.sto-control, .sto-navigation-item, .sto-segment-item):is(:disabled');
    expect(recipes).toContain("[aria-busy='true']");
    expect(recipes).toContain(".sto-feedback)[aria-invalid='true']");
    expect(recipes).not.toMatch(
      /\.sto-control[^{]*\[[^\]]*disabled[^\]]*\][^{]*\{[^}]*opacity\s*:/s,
    );
  });

  it('does not overload Radix data-state for semantic loading or error states', () => {
    for (const family of ['navigation-item', 'segment-item', 'overlay']) {
      expect(recipes).not.toContain(`.sto-${family}[data-state='loading']`);
      expect(recipes).not.toContain(`.sto-${family}[data-state='error']`);
    }

    expect(recipes).toContain(".sto-navigation-item[data-state='open']");
    expect(recipes).toContain(".sto-segment-item[data-state='active']");
    expect(read('src/components/ui/dialog.tsx')).toContain('data-[state=open]:animate-in');
  });

  it('preserves established focus-ring pixels without outlining whole overlays', () => {
    expect(tokens).toContain('--sto-focus-ring: hsl(var(--ring));');
    expect(tokens).toContain('--sto-focus-ring-offset: hsl(var(--background));');
    expect(tokens).toContain(
      '--sto-control-focus-shadow: 0 0 0 2px var(--sto-focus-ring-offset), 0 0 0 4px var(--sto-focus-ring);',
    );
    expect(tokens).toContain(
      '--sto-card-focus-shadow: 0 0 0 2px hsl(var(--ring) / 0.4);',
    );
    expect(recipes).not.toContain('.sto-overlay:has(:focus-visible)');
  });

  it('uses shared disabled semantics and keeps variant compositing explicit', () => {
    expect(recipes).toContain('--sto-interactive-disabled-background: color-mix(');
    expect(recipes).toContain('--sto-interactive-disabled-foreground: color-mix(');
    expect(recipes).toContain('--sto-interactive-disabled-border: color-mix(');
    expect(tokens).not.toMatch(
      /--sto-(?:interactive|neutral)-disabled-(?:foreground|background|border):/,
    );
    expect(tokens).not.toMatch(
      /--sto-(?:card|control|navigation|segment|overlay|feedback)-disabled-(?:foreground|background|border):/,
    );
    expect(recipes).toContain('.sto-control:has(:disabled)');
  });

  it('defines color-only recipes for fields, controls, segments, overlays and scrims', () => {
    for (const recipe of [
      '.sto-control--field',
      '.sto-control--outline',
      '.sto-control--secondary',
      '.sto-control--ghost',
      '.sto-segment-track',
      '.sto-segment-item',
      '.sto-overlay',
      '.sto-overlay-scrim',
    ]) {
      expect(recipes).toContain(recipe);
    }
  });

  it('removes component-owned neutral dark surface forks from shared primitives', () => {
    for (const file of primitiveFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/dark:(?:bg|border|text|hover:bg|focus:bg|data-\[state=open\]:bg|data-\[state=active\]:bg)-/);
    }
  });

  it('keeps every shared primitive attached to a semantic recipe', () => {
    const expectedRecipe: Record<(typeof primitiveFiles)[number], RegExp> = {
      'src/components/ui/button.tsx': /sto-control sto-control--/,
      'src/components/ui/input.tsx': /sto-control sto-control--field/,
      'src/components/ui/textarea.tsx': /sto-control sto-control--field/,
      'src/components/ui/tabs.tsx': /sto-segment-(?:track|item)/,
      'src/components/ui/select.tsx': /sto-control sto-control--field/,
      'src/components/ui/dialog.tsx': /sto-overlay/,
      'src/components/ui/dropdown-menu.tsx': /sto-overlay/,
      'src/components/ui/tooltip.tsx': /sto-overlay/,
    };

    for (const file of primitiveFiles) {
      expect(read(file), file).toMatch(expectedRecipe[file]);
    }
  });

  it('does not attach legacy and canonical aliases to the same migrated primitive', () => {
    for (const file of primitiveFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(
        /sto-(?:control-outline|control-secondary|control-ghost|control-field|overlay-glass-border)/,
      );
    }
  });

  it('keeps disabled color semantics readable in primitive source', () => {
    for (const file of [
      'src/components/ui/button.tsx',
      'src/components/ui/input.tsx',
      'src/components/ui/textarea.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/tabs.tsx',
      'src/components/ui/dropdown-menu.tsx',
    ]) {
      expect(read(file), file).not.toMatch(/disabled:opacity-|data-\[disabled\]:opacity-/);
    }
  });
});
