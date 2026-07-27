import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/components/more-apps/more-apps.css'),
  'utf8',
);

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? '';
};

describe('app plaza banner layout', () => {
  it.each([
    '.page-more-apps .app-market__hero-banner',
    '.page-more-apps .app-market__hero-carousel--loading .app-market__hero-skeleton',
    '.page-more-apps .app-market__hero-carousel--error .app-market__hero-error',
  ])('%s uses the 16:3 banner ratio', (selector) => {
    expect(rule(selector)).toMatch(/aspect-ratio:\s*16\s*\/\s*3\s*;/);
  });

  it('does not add a blue shadow in default or hover states', () => {
    expect(rule('.page-more-apps .app-market__hero-banner')).toMatch(
      /box-shadow:\s*none\s*;/,
    );
    expect(
      rule('.page-more-apps .app-market__hero-banner--clickable:hover'),
    ).toMatch(/box-shadow:\s*none\s*;/);
  });
});
