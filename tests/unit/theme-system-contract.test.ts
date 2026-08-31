import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import postcss from 'postcss';
import * as ts from 'typescript';
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
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls((declaration) => {
      declarations[declaration.prop] = declaration.value;
    });
  });

  return declarations;
}

function directDeclarations(rule: postcss.Rule): postcss.Declaration[] {
  return (rule.nodes ?? []).filter((node): node is postcss.Declaration => node.type === 'decl');
}

function semanticMappingSelectors(
  source: string,
  canonicalProperties?: ReadonlySet<string>,
): Set<string> {
  const selectors = new Set<string>();
  if (!source) return selectors;

  postcss.parse(source).walkRules((rule) => {
    const hasSemanticMapping = directDeclarations(rule).some((declaration) =>
      declaration.prop.startsWith('--sto-')
        && declaration.value.trim().length > 0
        && (!canonicalProperties || canonicalProperties.has(declaration.prop)),
    );
    if (!hasSemanticMapping) return;
    for (const selector of rule.selectors) selectors.add(selector);
  });
  return selectors;
}

function semanticMappingProperties(source: string, selectors: readonly string[]): Set<string> {
  const properties = new Set<string>();
  if (!source) return properties;

  postcss.parse(source).walkRules((rule) => {
    if (!rule.selectors.some((selector) => selectors.includes(selector))) return;
    directDeclarations(rule).forEach((declaration) => {
      if (declaration.prop.startsWith('--sto-') && declaration.value.trim().length > 0) {
        properties.add(declaration.prop);
      }
    });
  });
  return properties;
}

function missingSemanticMappings(source: string, requiredSelectors: readonly string[]): string[] {
  const definedSelectors = semanticMappingSelectors(source);
  return requiredSelectors.filter((selector) => !definedSelectors.has(selector));
}

function selectorContainsRecipe(selector: string, recipe: string): boolean {
  const escapedRecipe = recipe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escapedRecipe}(?=[\\s:.[#>,+~]|$)`).test(selector);
}

function missingSemanticRecipes(source: string, requiredRecipes: readonly string[]): string[] {
  const semanticRecipes = new Set<string>();
  if (!source) return [...requiredRecipes];

  postcss.parse(source).walkRules((rule) => {
    const consumesSemanticVariable = directDeclarations(rule).some((declaration) =>
      declaration.value.includes('var(--sto-'),
    );
    if (!consumesSemanticVariable) return;

    for (const recipe of requiredRecipes) {
      if (rule.selectors.some((selector) => selectorContainsRecipe(selector, recipe))) {
        semanticRecipes.add(recipe);
      }
    }
  });
  return requiredRecipes.filter((recipe) => !semanticRecipes.has(recipe));
}

function templateUsesIdentifier(node: ts.Node, identifier: string): boolean {
  let consumed = false;
  const visit = (candidate: ts.Node): void => {
    if (ts.isTemplateExpression(candidate)) {
      for (const span of candidate.templateSpans) {
        const inspectExpression = (expressionNode: ts.Node): void => {
          if (ts.isIdentifier(expressionNode) && expressionNode.text === identifier) consumed = true;
          expressionNode.forEachChild(inspectExpression);
        };
        inspectExpression(span.expression);
      }
    }
    candidate.forEachChild(visit);
  };
  visit(node);
  return consumed;
}

function returnedTemplateUsesIdentifier(
  declaration: ts.FunctionDeclaration,
  identifier: string,
): boolean {
  let consumed = false;
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      if (templateUsesIdentifier(node.expression, identifier)) consumed = true;
      return;
    }
    if (node !== declaration && ts.isFunctionLike(node)) return;
    node.forEachChild(visit);
  };
  declaration.body?.forEachChild(visit);
  return consumed;
}

function previewTokenContractGaps(source: string): Array<{ requirement: string; reason: string }> {
  const sourceFile = ts.createSourceFile('preview-srcdoc.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let importedIdentifier: string | undefined;
  let previewBuilder: ts.FunctionDeclaration | undefined;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && statement.moduleSpecifier.text === '@/styles/theme/tokens.css?raw') {
      importedIdentifier = statement.importClause?.name?.text;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'buildPreviewThemeStyle') {
      previewBuilder = statement;
    }
  }

  const gaps: Array<{ requirement: string; reason: string }> = [];
  if (!importedIdentifier) {
    gaps.push({
      requirement: 'import tokens.css?raw',
      reason: 'Migration debt: Task 4 makes adaptive preview consume the canonical token stylesheet.',
    });
  } else if (!previewBuilder || !returnedTemplateUsesIdentifier(previewBuilder, importedIdentifier)) {
    gaps.push({
      requirement: `consume imported ${importedIdentifier} in returned preview style`,
      reason: 'Contract violation: the canonical token import must be interpolated into buildPreviewThemeStyle output.',
    });
  }

  const duplicatePalette = source.match(/--sto-preview-[\w-]+:\s*(?:#|rgba?\()/g) ?? [];
  gaps.push(...duplicatePalette.map((value) => ({
    requirement: `remove duplicate preview literal ${value}`,
    reason: 'Migration debt: Task 4 removes this exact preview palette copy after adding the canonical import.',
  })));
  return gaps;
}

function sourceFiles(directory: string, extensions: readonly string[]): Array<{ file: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path, extensions);
      if (!extensions.includes(extname(entry.name))) return [];
      return [{
        file: relative(process.cwd(), path).replaceAll('\\', '/'),
        source: readFileSync(path, 'utf8'),
      }];
    });
}

describe('theme system contract', () => {
  it('does not accept empty or commented token mappings', () => {
    const source = `
      /* :root { --sto-text-primary: #111111; } */
      :root {}
      html[data-sto-theme='light'] { color-scheme: light; }
    `;
    expect(missingSemanticMappings(source, [
      ':root',
      "html[data-sto-theme='light']",
    ])).toEqual([
      ':root',
      "html[data-sto-theme='light']",
    ]);
    expect(missingSemanticMappings(`
      :root,
      html[data-sto-theme='light'] { --sto-text-primary: #111111; }
    `, [':root', "html[data-sto-theme='light']"])).toEqual([]);
  });

  it('does not accept recipe names in comments or empty recipe rules', () => {
    const source = `
      /* .sto-card { color: var(--sto-text-primary); } */
      .sto-control {}
      .sto-overlay { display: block; }
    `;
    const requiredRecipes = ['.sto-card', '.sto-control', '.sto-overlay'];
    expect(missingSemanticRecipes(source, requiredRecipes)).toEqual(requiredRecipes);
    expect(missingSemanticRecipes(`
      .sto-card { color: var(--sto-text-primary); }
      .sto-control:hover { background: var(--sto-control-hover-bg); }
      .dark .sto-overlay { border-color: var(--sto-border-default); }
    `, requiredRecipes)).toEqual([]);
  });

  it('does not accept an unused canonical token import in preview code', () => {
    const source = `
      import themeTokensCss from '@/styles/theme/tokens.css?raw';
      function buildPreviewThemeStyle() {
        return \`<style data-sto-preview-theme>body { color: red; }</style>\`;
      }
    `;
    expect(previewTokenContractGaps(source)).toEqual([{
      requirement: 'consume imported themeTokensCss in returned preview style',
      reason: 'Contract violation: the canonical token import must be interpolated into buildPreviewThemeStyle output.',
    }]);
    expect(previewTokenContractGaps(`
      import themeTokensCss from '@/styles/theme/tokens.css?raw';
      function buildPreviewThemeStyle() {
        const unused = \`\${themeTokensCss}\`;
        return \`<style data-sto-preview-theme>body { color: red; }</style>\`;
      }
    `)).toEqual([{
      requirement: 'consume imported themeTokensCss in returned preview style',
      reason: 'Contract violation: the canonical token import must be interpolated into buildPreviewThemeStyle output.',
    }]);
    expect(previewTokenContractGaps(`
      import themeTokensCss from '@/styles/theme/tokens.css?raw';
      function buildPreviewThemeStyle() {
        return \`<style data-sto-preview-theme>\${themeTokensCss}</style>\`;
      }
    `)).toEqual([]);
  });

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
    expect(dark['--sto-card-flat-bg']).toBe('#181818');
    expect(dark['--sto-card-flat-hover-bg']).toBe('#212121');
    expect(dark['--sto-card-flat-hover-border']).toBe('var(--sto-border-default)');
    expect(dark['--sto-card-panel-bg']).toBe('#181818');
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
    expect(rules).toContain('唯一映射所有者');
    expect(rules).toContain('唯一共享交互状态颜色所有者');
    expect(rules).toContain('页面只能定义布局');
    expect(rules).toContain('所有新增或修改的代码');
    expect(rules).toContain('精确非增长快照');
    expect(rules).toContain('新增例外');
    expect(rules).toContain('CollectionCardAction');
    expect(rules).toContain('default → hover → active/selected → focus → disabled → loading → empty → error');
    expect(rules).toContain('浅色是当前视觉基线');
    expect(rules).toContain('Adaptive');
    expect(rules).toContain('Fidelity');
  });

  it('keeps renderer and preview theme mappings in tokens.css', () => {
    const tokens = readIfPresent(themeTokensPath);
    expect(tokens).toContain(':root,');
    expect(tokens).toContain("html[data-sto-theme='light']");
    expect(tokens).toContain('.dark,');
    expect(tokens).toContain("html[data-sto-theme='dark']");

    const requiredSelectors = [
      ':root',
      "html[data-sto-theme='light']",
      '.dark',
      "html[data-sto-theme='dark']",
    ];
    const missingSelectors = missingSemanticMappings(tokens, requiredSelectors)
      .map((selector) => ({
        selector,
        reason: 'Migration debt: Task 4 adds the explicit data-sto-theme selector to the canonical token owner.',
      }));

    expect(missingSelectors).toMatchSnapshot();

    const canonicalProperties = semanticMappingProperties(tokens, requiredSelectors);
    const unexpectedOwners = sourceFiles(resolve(process.cwd(), 'src'), ['.css'])
      .filter(({ file }) => file !== 'src/styles/theme/tokens.css')
      .flatMap(({ file, source }) => [...semanticMappingSelectors(source, canonicalProperties)]
        .filter((selector) => requiredSelectors.includes(selector))
        .map((selector) => ({
          file,
          selector,
          reason: 'Migration debt: Task 4 moves this semantic theme mapping into the canonical tokens.css owner.',
        })));
    expect(unexpectedOwners).toMatchSnapshot();
  });

  it('keeps all shared visual state families in recipes.css', () => {
    const recipes = readIfPresent(themeRecipesPath);
    const requiredRecipes = [
      '.sto-card',
      '.sto-control',
      '.sto-navigation-item',
      '.sto-segment-item',
      '.sto-overlay',
      '.sto-feedback',
    ];
    const missingRecipes = missingSemanticRecipes(recipes, requiredRecipes)
      .map((recipe) => ({
        recipe,
        reason: 'Migration debt: Task 5 completes this shared state family in recipes.css.',
      }));

    expect(missingRecipes).toMatchSnapshot();
  });

  it('keeps ordinary CSS and TSX free of local dark palette branches', () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const cssOwners = new Set([
      'src/styles/theme/tokens.css',
      'src/styles/theme/recipes.css',
    ]);
    const darkSelectors = sourceFiles(srcRoot, ['.css']).flatMap(({ file, source }) =>
      cssOwners.has(file) || !/^[\t ]*\.dark\b/m.test(source) ? [] : [file],
    );
    const darkUtilities = sourceFiles(srcRoot, ['.tsx']).flatMap(({ file, source }) =>
      /dark:(?:bg|text|border|shadow|ring)-/.test(source) ? [file] : [],
    );

    expect({
      darkSelectors: darkSelectors.map((file) => ({
        file,
        reason: 'Migration debt: page-owned dark selectors move to shared tokens or recipes in Tasks 7-8.',
      })),
      darkUtilities: darkUtilities.map((file) => ({
        file,
        reason: 'Migration debt: color-bearing dark utilities move to shared recipes in Tasks 6-8.',
      })),
    }).toMatchSnapshot();
  });

  it('reuses tokens.css in preview code instead of maintaining a second palette', () => {
    const previewSource = readFileSync(resolve(process.cwd(), 'src/lib/preview-srcdoc.ts'), 'utf8');
    expect(previewTokenContractGaps(previewSource)).toMatchSnapshot();
  });
});
