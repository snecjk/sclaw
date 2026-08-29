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
const surfaces = read('src/lib/surfaces.ts');

describe('semantic card color recipes', () => {
  it('keeps the existing light Home card colors while flattening ordinary dark cards', () => {
    expect(tokensCss).toMatch(/--sto-card-flat-bg:\s*#ffffff/);
    expect(tokensCss).toMatch(/--sto-card-flat-border:\s*var\(--sto-border-default\)/);
    expect(tokensCss).toMatch(/--sto-card-flat-hover-shadow:\s*0 0 16px rgba\(0, 0, 0, 0\.12\)/);
    expect(tokensCss).toMatch(/\.dark\s*\{[\s\S]*--sto-card-flat-bg:\s*transparent/);
    expect(tokensCss).toMatch(/\.dark\s*\{[\s\S]*--sto-card-flat-hover-bg:\s*#181818/);
    expect(tokensCss).toMatch(/\.dark\s*\{[\s\S]*--sto-card-flat-hover-shadow:\s*none/);
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
    expect(recipesCss).toContain('.sto-card-panel');
    expect(card).toContain('sto-card-panel');
    expect(card).not.toMatch(/['"`]glass(?:\s|['"`])/);
  });

  it('shares color recipes without changing each card family geometry', () => {
    for (const consumer of [moreAppsPage, appCard, skillCard, connectorCard]) {
      expect(consumer).toContain('collectionCardShellClass');
    }

    expect(surfaces).toContain(`export const collectionCardShellClass = cn(
  'sto-card-flat sto-card-flat-interactive',
  'transition-[background-color,border-color,box-shadow] duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
);`);
    expect(surfaces).toMatch(
      /workflowListCardShellClass[\s\S]*collectionCardShellClass[\s\S]*rounded-\[18px\][\s\S]*border/,
    );
    expect(connectorCard).toContain('rounded-2xl border px-4');
    expect(skillCard).toContain('rounded-2xl border p-4');
    expect(moreAppsCss).toMatch(/\.app-market__row\s*\{[\s\S]*border:\s*0\.8px solid var\(--ma-card-border\);[\s\S]*border-radius:\s*18px;/);
    expect(moreAppsCss).toMatch(/\.more-apps-card\s*\{[\s\S]*border:\s*1px solid var\(--ma-border\);[\s\S]*border-radius:\s*14px;/);
  });
});
