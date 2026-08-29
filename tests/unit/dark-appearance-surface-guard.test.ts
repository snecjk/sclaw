import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const guardedFiles = [
  'src/components/skill-plaza/SkillPlazaHeader.tsx',
  'src/components/skill-plaza/SkillPlazaCategoryNav.tsx',
  'src/components/skill-plaza/SkillIcon.tsx',
  'src/components/skill-plaza/SkillCard.tsx',
  'src/components/skill-plaza/SkillPlazaPage.tsx',
  'src/components/skill-plaza/SkillUploadModal.tsx',
  'src/components/workflow/WorkflowPreviewPanel.tsx',
  'src/components/connectors/ConnectorCard.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/input.tsx',
  'src/components/ui/tabs.tsx',
  'src/components/ui/dropdown-menu.tsx',
  'src/components/file-preview/SaveArtifactDialog.tsx',
  'src/components/file-preview/ArtifactShareDialog.tsx',
] as const;

const taskSixFiles = guardedFiles.slice(5);

function readSource(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function combineClassVariants(left: string[], right: string[]): string[] {
  const combined: string[] = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      combined.push(`${leftValue} ${rightValue}`.trim());
    }
  }
  return unique(combined);
}

function propertyNameText(name: ts.PropertyName | undefined): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function collectVariableInitializers(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
  const initializers = new Map<string, ts.Expression>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return initializers;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function callName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function classExpressionVariants(
  rawExpression: ts.Expression,
  initializers: Map<string, ts.Expression>,
  resolving = new Set<string>(),
): string[] {
  const expression = unwrapExpression(rawExpression);

  if (ts.isStringLiteralLike(expression)) return [expression.text];

  if (ts.isTemplateExpression(expression)) {
    let variants = [expression.head.text];
    for (const span of expression.templateSpans) {
      const expressionVariants = classExpressionVariants(span.expression, initializers, resolving);
      variants = combineClassVariants(variants, expressionVariants.length > 0 ? expressionVariants : ['']);
      variants = variants.map((variant) => `${variant}${span.literal.text}`);
    }
    return unique(variants);
  }

  if (ts.isConditionalExpression(expression)) {
    return unique([
      ...classExpressionVariants(expression.whenTrue, initializers, resolving),
      ...classExpressionVariants(expression.whenFalse, initializers, resolving),
    ]);
  }

  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return unique(['', ...classExpressionVariants(expression.right, initializers, resolving)]);
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return unique([
        ...classExpressionVariants(expression.left, initializers, resolving),
        ...classExpressionVariants(expression.right, initializers, resolving),
      ]);
    }
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combineClassVariants(
        classExpressionVariants(expression.left, initializers, resolving),
        classExpressionVariants(expression.right, initializers, resolving),
      );
    }
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.reduce<string[]>(
      (variants, element) => combineClassVariants(
        variants,
        ts.isExpression(element)
          ? classExpressionVariants(element, initializers, resolving)
          : [''],
      ),
      [''],
    );
  }

  if (ts.isCallExpression(expression)) {
    const name = callName(expression.expression);
    if (name === 'cn' || name === 'clsx' || name === 'classnames') {
      return expression.arguments.reduce<string[]>(
        (variants, argument) => combineClassVariants(
          variants,
          classExpressionVariants(argument, initializers, resolving),
        ),
        [''],
      );
    }
    return [''];
  }

  if (ts.isIdentifier(expression)) {
    if (resolving.has(expression.text)) return [''];
    const initializer = initializers.get(expression.text);
    if (!initializer) return [''];
    const nextResolving = new Set(resolving);
    nextResolving.add(expression.text);
    return classExpressionVariants(initializer, initializers, nextResolving);
  }

  return [''];
}

function collectCvaClassGroups(
  call: ts.CallExpression,
  initializers: Map<string, ts.Expression>,
): string[] {
  const groups = call.arguments[0]
    ? classExpressionVariants(call.arguments[0], initializers)
    : [];
  const config = call.arguments[1];
  if (!config || !ts.isObjectLiteralExpression(config)) return groups;

  for (const configProperty of config.properties) {
    if (!ts.isPropertyAssignment(configProperty)) continue;
    const configName = propertyNameText(configProperty.name);

    if (configName === 'variants' && ts.isObjectLiteralExpression(configProperty.initializer)) {
      for (const variantAxis of configProperty.initializer.properties) {
        if (!ts.isPropertyAssignment(variantAxis)) continue;
        if (!ts.isObjectLiteralExpression(variantAxis.initializer)) continue;
        for (const variantChoice of variantAxis.initializer.properties) {
          if (!ts.isPropertyAssignment(variantChoice)) continue;
          groups.push(...classExpressionVariants(variantChoice.initializer, initializers));
        }
      }
    }

    if (
      configName === 'compoundVariants'
      && ts.isArrayLiteralExpression(configProperty.initializer)
    ) {
      for (const compoundVariant of configProperty.initializer.elements) {
        if (!ts.isObjectLiteralExpression(compoundVariant)) continue;
        for (const property of compoundVariant.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const propertyName = propertyNameText(property.name);
          if (propertyName === 'class' || propertyName === 'className') {
            groups.push(...classExpressionVariants(property.initializer, initializers));
          }
        }
      }
    }
  }

  return groups;
}

function extractClassExpressionGroups(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    'dark-appearance-surface-guard.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const initializers = collectVariableInitializers(sourceFile);
  const groups: string[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node)
      && node.name.text === 'className'
      && node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        groups.push(node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        groups.push(...classExpressionVariants(node.initializer.expression, initializers));
      }
    }

    if (
      ts.isCallExpression(node)
      && callName(node.expression) === 'cva'
    ) {
      groups.push(...collectCvaClassGroups(node, initializers));
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return unique(groups.map((group) => group.trim()).filter(Boolean));
}

function findUnpairedLightControls(source: string): string[] {
  const checks = [
    {
      light: /^bg-white(?:\/[\w.[\]-]+)?$/i,
      dark: /dark:bg-/i,
      label: 'bg-white',
    },
    {
      light: /^text-\[#1D2129\]$/i,
      dark: /dark:text-/i,
      label: 'text-[#1D2129]',
    },
    {
      light: /^hover:bg-\[#F2F3F5\]$/i,
      dark: /dark:hover:bg-/i,
      label: 'hover:bg-[#F2F3F5]',
    },
  ] as const;

  const failures = new Set<string>();
  for (const group of extractClassExpressionGroups(source)) {
    const classes = group.split(/\s+/);
    for (const check of checks) {
      if (classes.some((className) => check.light.test(className)) && !check.dark.test(group)) {
        failures.add(`${check.label}: ${group}`);
      }
    }
  }
  return [...failures];
}

const legacyDarkSurfacePatterns = [
  /dark:(?:bg|text|border|hover:bg|hover:border|hover:text|focus:border)-(?:background|card|popover|foreground|muted(?:-foreground)?)(?:\/[\w.[\]-]+)?/,
  /dark:(?:bg|text|border|hover:bg|hover:border|hover:text|focus:border)-white(?:\/[\w.[\]-]+)?/,
  /dark:(?:bg|text|border|hover:bg|hover:border)-\[#(?:1f2325|252a2e|343a40|46515a)\]/i,
  /dark:bg-\[hsl\(var\(--(?:card|popover|glass-bg)\)/,
] as const;

const requiredSemanticFragments: Record<(typeof taskSixFiles)[number], readonly string[]> = {
  'src/components/skill-plaza/SkillUploadModal.tsx': [
    'dark:bg-[var(--sto-control-bg)]',
    'dark:bg-[var(--sto-surface-elevated)]',
  ],
  'src/components/workflow/WorkflowPreviewPanel.tsx': [
    'dark:bg-[var(--sto-surface-primary)]',
    'dark:bg-[var(--sto-surface-secondary)]',
    'dark:text-[var(--sto-text-primary)]',
  ],
  'src/components/connectors/ConnectorCard.tsx': [
    'dark:bg-[var(--sto-surface-elevated)]',
    'dark:hover:bg-[var(--sto-control-hover-bg)]',
  ],
  'src/components/ui/button.tsx': [
    'sto-control-outline',
    'sto-control-secondary',
    'sto-control-ghost',
  ],
  'src/components/ui/input.tsx': [
    'sto-control-field',
  ],
  'src/components/ui/tabs.tsx': [
    'sto-segment-track',
    'sto-segment-item',
  ],
  'src/components/ui/dropdown-menu.tsx': [
    'sto-overlay',
    'sto-overlay-glass-border',
  ],
  'src/components/file-preview/SaveArtifactDialog.tsx': [
    'dark:bg-[var(--sto-surface-secondary)]',
    'dark:bg-[var(--sto-surface-elevated)]',
    'dark:hover:bg-[var(--sto-control-hover-bg)]',
  ],
  'src/components/file-preview/ArtifactShareDialog.tsx': [
    'dark:bg-[var(--sto-surface-elevated)]',
    'dark:border-[var(--sto-border-default)]',
  ],
};

describe('dark appearance application surface guard', () => {
  it.each([
    ['bg-white', '<div className="bg-white" />'],
    ['text-[#1D2129]', '<div className="text-[#1D2129]" />'],
    ['hover:bg-[#F2F3F5]', '<button className="hover:bg-[#F2F3F5]" />'],
  ])('reports an isolated %s class', (label, source) => {
    expect(findUnpairedLightControls(source)).toEqual([expect.stringContaining(label)]);
  });

  it('expands template literal variants instead of letting an optional dark class mask light', () => {
    const source = `
      <div className={\`bg-white \${enabled ? 'dark:bg-[var(--sto-control-bg)]' : ''}\`} />;
    `;
    expect(findUnpairedLightControls(source)).toEqual([
      expect.stringContaining('bg-white'),
    ]);
  });

  it('does not pair light and dark tokens from separate class expressions', () => {
    const source = `
      <div className="bg-white" />;
      <div className="dark:bg-[var(--sto-control-bg)]" />;
    `;
    expect(findUnpairedLightControls(source)).toEqual([
      expect.stringContaining('bg-white'),
    ]);
  });

  it('does not let an unrelated adjacent array hide a class expression violation', () => {
    const source = `
      const unrelated = ['bg-white', 'dark:bg-[var(--sto-control-bg)]'];
      const visibleClass = 'bg-white';
      <div className={visibleClass} />;
    `;
    expect(findUnpairedLightControls(source)).toEqual([
      expect.stringContaining('bg-white'),
    ]);
  });

  it('accepts paired multiline strings within the same cn expression', () => {
    const source = `
      <div className={cn(
        'bg-white border-border',
        'dark:bg-[var(--sto-control-bg)]',
      )} />;
    `;
    expect(findUnpairedLightControls(source)).toEqual([]);
  });

  it('ignores comments and translation strings that resemble utility classes', () => {
    const source = `
      // bg-white dark:bg-background
      const label = translate('bg-white');
      <div className="p-2" title={label} />;
    `;
    expect(findUnpairedLightControls(source)).toEqual([]);
  });

  it.each(guardedFiles)('%s pairs light controls with a dark branch', (file) => {
    expect(findUnpairedLightControls(readSource(file))).toEqual([]);
  });

  it.each(taskSixFiles)('%s uses semantic tokens instead of legacy dark neutrals', (file) => {
    const source = readSource(file);
    const classGroups = extractClassExpressionGroups(source);
    const failures = legacyDarkSurfacePatterns.flatMap((pattern) =>
      classGroups.flatMap((group) =>
        Array.from(group.matchAll(new RegExp(pattern, 'g')), (match) => match[0]),
      ),
    );
    expect(failures).toEqual([]);
    for (const fragment of requiredSemanticFragments[file]) {
      expect(classGroups.some((group) => group.includes(fragment))).toBe(true);
    }
  });

  it('keeps exact Word and slide fidelity canvases outside the application surface guard', () => {
    const globals = readSource('src/styles/globals.css');
    expect(globals).toMatch(
      /\.sclaw-pptx-host \.pptx-preview-wrapper\s*\{\s*background:\s*#fff;/,
    );
    expect(globals).toMatch(
      /\.sclaw-docx-host \.docx-wrapper > section\.docx\s*\{\s*background:\s*#fff;/,
    );
  });
});
