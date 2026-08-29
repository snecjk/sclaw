import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const recipes = read('src/styles/theme/recipes.css');

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
      for (const state of ['hover', 'active', 'focus', 'disabled', 'loading', 'error']) {
        expect(recipes).toContain(`.sto-${family}[data-state='${state}']`);
      }
    }

    expect(recipes).toContain('.sto-control:focus-visible');
    expect(recipes).toContain('.sto-control:disabled');
    expect(recipes).toContain(".sto-control[aria-invalid='true']");
    expect(recipes).not.toMatch(
      /\.sto-control[^{]*\[[^\]]*disabled[^\]]*\][^{]*\{[^}]*opacity\s*:/s,
    );
  });

  it('defines color-only recipes for fields, controls, segments, overlays and scrims', () => {
    for (const recipe of [
      '.sto-control-field',
      '.sto-control-outline',
      '.sto-control-secondary',
      '.sto-control-ghost',
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
      'src/components/ui/input.tsx': /sto-control sto-control-field/,
      'src/components/ui/textarea.tsx': /sto-control sto-control-field/,
      'src/components/ui/tabs.tsx': /sto-segment-(?:track|item)/,
      'src/components/ui/select.tsx': /sto-control sto-control-field/,
      'src/components/ui/dialog.tsx': /sto-overlay/,
      'src/components/ui/dropdown-menu.tsx': /sto-overlay/,
      'src/components/ui/tooltip.tsx': /sto-overlay/,
    };

    for (const file of primitiveFiles) {
      expect(read(file), file).toMatch(expectedRecipe[file]);
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
