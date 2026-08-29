import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const tokensCss = read('src/styles/theme/tokens.css');
const recipesCss = read('src/styles/theme/recipes.css');
const homeSurfaces = read('src/pages/Home/home-hub-surface-styles.ts');
const recommendCard = read('src/pages/Home/RecommendCard.tsx');
const card = read('src/components/ui/card.tsx');
const moreAppsPage = read('src/components/more-apps/MoreAppsPage.tsx');
const appCard = read('src/components/more-apps/AppCard.tsx');
const moreAppsCss = read('src/components/more-apps/more-apps.css');
const skillCard = read('src/components/skill-plaza/SkillCard.tsx');
const connectorCard = read('src/components/connectors/ConnectorCard.tsx');
const workflowPicker = read('src/components/workflow/WorkflowPicker.tsx');
const workflowListCard = read('src/pages/Workflow/components/workflow-list-card.tsx');
const taskCard = read('src/pages/MyTask/components/TaskCard.tsx');
const surfaces = read('src/lib/surfaces.ts');

describe('semantic card color recipes', () => {
  it('defines the complete card state chain with semantic color values', () => {
    for (const selector of [
      '.sto-card',
      "[data-sto-state='hover']",
      "[data-sto-state='active']",
      "[data-selected='true']",
      ':has(:focus-visible)',
      "[aria-disabled='true']",
      "[aria-busy='true']",
      "[aria-invalid='true']",
    ]) {
      expect(recipesCss, selector).toContain(selector);
    }
    expect(recipesCss).toContain('--sto-disabled-foreground');
    expect(recipesCss).toContain('--sto-disabled-background');
    expect(recipesCss).toContain('--sto-disabled-border');
    expect(recipesCss).not.toMatch(
      /\.sto-card[^{]*\[[^\]]*disabled[^\]]*\][^{]*\{[^}]*opacity\s*:/s,
    );
  });

  it('keeps the existing light Home card colors while flattening ordinary dark cards', () => {
    expect(tokensCss).toMatch(/--sto-card-flat-bg:\s*#ffffff/);
    expect(tokensCss).toMatch(/--sto-card-flat-border:\s*var\(--sto-border-default\)/);
    expect(tokensCss).toMatch(/--sto-card-flat-hover-shadow:\s*0 0 16px rgba\(0, 0, 0, 0\.12\)/);
    expect(tokensCss).toMatch(/\.dark,\s*html\[data-sto-theme='dark'\]\s*\{[\s\S]*--sto-card-flat-bg:\s*transparent/);
    expect(tokensCss).toMatch(/\.dark,\s*html\[data-sto-theme='dark'\]\s*\{[\s\S]*--sto-card-flat-hover-bg:\s*#181818/);
    expect(tokensCss).toMatch(/\.dark,\s*html\[data-sto-theme='dark'\]\s*\{[\s\S]*--sto-card-flat-hover-shadow:\s*none/);
  });

  it('owns card colors in recipes rather than Home component strings', () => {
    expect(recipesCss).toContain('.sto-card-flat');
    expect(recipesCss).toContain('.sto-card-flat-interactive:hover');
    expect(homeSurfaces).toContain('sto-card-flat');
    expect(homeSurfaces).toContain('sto-card-flat-interactive');
    expect(homeSurfaces).not.toMatch(/bg-white|dark:bg-|border-\[#|hover:border-\[#/);
    expect(recommendCard).not.toMatch(/hover:shadow-\[|dark:hover:border-border/);
  });

  it('uses the shared panel recipe without retaining the legacy glass class', () => {
    expect(recipesCss).toContain('.sto-card');
    expect(card).toContain('sto-card');
    expect(card).not.toMatch(/['"`]glass(?:\s|['"`])/);
  });

  it('shares color recipes without changing each card family geometry', () => {
    for (const consumer of [moreAppsPage, appCard, skillCard, connectorCard]) {
      expect(consumer).toContain('collectionCardShellClass');
    }

    expect(surfaces).toContain(`export const collectionCardShellClass = cn(
  'sto-card sto-card--flat sto-card--interactive sto-collection-card',
  'transition-[background-color,border-color,box-shadow] duration-150',
);`);
    expect(surfaces).toMatch(
      /workflowListCardShellClass[\s\S]*collectionCardShellClass[\s\S]*rounded-\[18px\][\s\S]*border/,
    );
    expect(connectorCard).toContain('rounded-2xl border px-4');
    expect(skillCard).toContain('rounded-2xl border p-4');
    for (const [selector, borderWidth, borderRadius] of [
      ['app-market__row', '0.8px', '18px'],
      ['more-apps-card', '1px', '14px'],
    ] as const) {
      const block = moreAppsCss.match(new RegExp(`\\.page-more-apps \\.${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(block).toContain(`border-width: ${borderWidth}`);
      expect(block).toContain(`border-radius: ${borderRadius}`);
      expect(block).not.toMatch(/(?:background|border-color|box-shadow)\s*:/);
    }
  });

  it('uses one sibling overlay action across clickable collection card families', () => {
    expect(recipesCss).toContain('.sto-collection-card');
    expect(recipesCss).toContain('.sto-collection-card__action');
    expect(recipesCss).toMatch(/\.sto-collection-card__action\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;[\s\S]*z-index:\s*1;/);
    expect(recipesCss).toMatch(/\.sto-collection-card :where\(button, a, input, select, textarea, \[role='button'\]\):not\(\.sto-collection-card__action\)[^{]*\{[^}]*z-index:\s*2;/s);
    expect(recipesCss).toMatch(/\.sto-collection-card[^{]*:has\(\.sto-collection-card__action:focus-visible\)/);
    expect(recipesCss).toMatch(/\.sto-collection-card:has\(\.sto-collection-card__action:focus-visible\)[^{]*\{[^}]*box-shadow:\s*0 0 0 2px var\(--sto-focus-ring\)/s);

    for (const consumer of [
      moreAppsPage,
      appCard,
      skillCard,
      connectorCard,
      workflowListCard,
      taskCard,
    ]) {
      expect(consumer).toContain('CollectionCardAction');
    }

    expect(surfaces).toMatch(
      /workflowListCardShellClass[\s\S]*collectionCardShellClass/,
    );
    expect(workflowPicker).toContain('sto-navigation-item');
  });

  it('does not retain emulated button semantics on migrated card shells', () => {
    expect(connectorCard).not.toContain('role="button"');
    expect(connectorCard).not.toContain('tabIndex={0}');
    expect(moreAppsPage).not.toContain('role="button"');
    expect(moreAppsPage).not.toContain('tabIndex={0}');
  });
});
