import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const themeTokensPath = resolve(process.cwd(), 'src/styles/theme/tokens.css');
const themeRecipesPath = resolve(process.cwd(), 'src/styles/theme/recipes.css');
const globalsPath = resolve(process.cwd(), 'src/styles/globals.css');
const styleRulesPath = resolve(process.cwd(), '.cursor/rules/02-styles.mdc');
const retiredThemeBackupPath = resolve(process.cwd(), 'src/styles/globals.old.css');

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function declarationsFor(source: string, selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  if (!source) return declarations;

  postcss.parse(source).walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
  });

  return declarations;
}

describe('theme system contract', () => {
  it('keeps theme ownership in the two approved production CSS files', () => {
    expect(existsSync(themeTokensPath)).toBe(true);
    expect(existsSync(themeRecipesPath)).toBe(true);

    const globals = readFileSync(globalsPath, 'utf8');
    expect(globals).toContain("@import './theme/tokens.css';");
    expect(globals).toContain("@import './theme/recipes.css';");
    expect(globals).not.toContain('--sto-color-brand-hsl:');
    expect(globals).not.toContain('--sto-text-primary:');
    expect(globals).not.toContain('--sto-border-default:');
  });

  it('freezes light surfaces and maps dark card roles to the approved hierarchy', () => {
    const tokens = readIfPresent(themeTokensPath);
    const light = declarationsFor(tokens, ':root');
    const dark = declarationsFor(tokens, '.dark');

    expect(light['--sto-surface-canvas']).toBe('#f7f8fa');
    expect(light['--sto-card-flat-bg']).toBe('#ffffff');
    expect(light['--sto-card-panel-bg']).toBe('#ffffff');
    expect(light['--sto-text-primary']).toBe('#1d2129');
    expect(light['--sto-border-default']).toBe('#e5e6eb');

    expect(dark['--sto-surface-canvas']).toBe('#0d0d0d');
    expect(dark['--sto-card-flat-bg']).toBe('transparent');
    expect(dark['--sto-card-flat-hover-bg']).toBe('#181818');
    expect(dark['--sto-card-panel-bg']).toBe('#181818');
    expect(dark['--sto-card-inset-bg']).toBe('#212121');
    expect(dark['--sto-card-elevated-bg']).toBe('#282828');
    expect(dark['--sto-text-primary']).toBe('#dfdfdf');
    expect(dark['--sto-border-default']).toBe('rgba(255, 255, 255, 0.08)');
  });

  it('keeps the base generic palette unchanged while exposing semantic roles', () => {
    const light = declarationsFor(readIfPresent(themeTokensPath), ':root');

    expect(light['--primary']).toBe('26 100% 50%');
    expect(light['--background']).toBe('220 14% 97%');
    expect(light['--foreground']).toBe('220 26% 14%');
    expect(light['--card']).toBe('var(--sto-color-white-hsl)');
    expect(light['--border']).toBe('220 13% 91%');
  });

  it('keeps the reusable theme rules aligned with the production owners', () => {
    expect(existsSync(styleRulesPath)).toBe(true);
    expect(existsSync(retiredThemeBackupPath)).toBe(false);

    const rules = readFileSync(styleRulesPath, 'utf8');
    expect(rules).toContain('src/styles/theme/tokens.css');
    expect(rules).toContain('src/styles/theme/recipes.css');
    expect(rules).toContain('浅色是当前视觉基线');
    expect(rules).toContain('Adaptive');
    expect(rules).toContain('Fidelity');
  });
});
