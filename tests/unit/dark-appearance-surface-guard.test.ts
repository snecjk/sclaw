import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardedFiles = [
  'src/components/skill-plaza/SkillPlazaHeader.tsx',
  'src/components/skill-plaza/SkillPlazaCategoryNav.tsx',
  'src/components/skill-plaza/SkillIcon.tsx',
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

const taskSixFiles = guardedFiles.slice(3);

interface StringLiteral {
  start: number;
  end: number;
  value: string;
}

function readSource(file: string): string {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

function extractStringLiterals(source: string): StringLiteral[] {
  const literals: StringLiteral[] = [];
  let index = 0;

  while (index < source.length) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      index += 1;
      continue;
    }

    const start = index;
    let value = '';
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        value += character + (source[index + 1] ?? '');
        index += 2;
        continue;
      }
      if (character === quote) {
        index += 1;
        literals.push({ start, end: index, value });
        break;
      }
      value += character;
      index += 1;
    }
  }

  return literals;
}

function normalizedAdjacentStringGroups(source: string): string[] {
  const literals = extractStringLiterals(source);
  const groups: string[] = [];
  let current = '';
  let previousEnd = -1;

  for (const literal of literals) {
    const separator = previousEnd < 0 ? '' : source.slice(previousEnd, literal.start);
    if (previousEnd >= 0 && !/^[\s,]*$/.test(separator)) {
      if (current) groups.push(current);
      current = '';
    }
    current = current ? `${current} ${literal.value}` : literal.value;
    previousEnd = literal.end;
  }
  if (current) groups.push(current);
  return groups;
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

  const failures: string[] = [];
  for (const group of normalizedAdjacentStringGroups(source)) {
    const classes = group.split(/\s+/);
    for (const check of checks) {
      if (classes.some((className) => check.light.test(className)) && !check.dark.test(group)) {
        failures.push(`${check.label}: ${group}`);
      }
    }
  }
  return failures;
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
    'dark:bg-[var(--sto-surface-secondary)]',
    'dark:bg-[var(--sto-surface-elevated)]',
    'dark:hover:bg-[var(--sto-control-hover-bg)]',
  ],
  'src/components/ui/button.tsx': [
    'dark:bg-[var(--sto-control-bg)]',
    'dark:hover:bg-[var(--sto-control-hover-bg)]',
  ],
  'src/components/ui/input.tsx': [
    'dark:bg-[var(--sto-control-bg)]',
    'dark:border-[var(--sto-border-default)]',
  ],
  'src/components/ui/tabs.tsx': [
    'dark:bg-[var(--sto-control-bg)]',
    'dark:data-[state=active]:bg-[var(--sto-control-active-bg)]',
  ],
  'src/components/ui/dropdown-menu.tsx': [
    'dark:bg-[var(--sto-surface-elevated)]',
    'dark:border-[var(--sto-border-default)]',
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
  it('normalizes adjacent multiline strings without allowing a whole file', () => {
    const source = `
      cn(
        'bg-white border-border',
        'dark:bg-[var(--sto-control-bg)]',
      );
      cn('bg-white', condition && 'dark:bg-[var(--sto-control-bg)]');
    `;
    expect(findUnpairedLightControls(source)).toEqual(['bg-white: bg-white']);
  });

  it.each(guardedFiles)('%s pairs light controls with a dark branch', (file) => {
    expect(findUnpairedLightControls(readSource(file))).toEqual([]);
  });

  it.each(taskSixFiles)('%s uses semantic tokens instead of legacy dark neutrals', (file) => {
    const source = readSource(file);
    const failures = legacyDarkSurfacePatterns.flatMap((pattern) =>
      Array.from(source.matchAll(new RegExp(pattern, 'g')), (match) => match[0]),
    );
    expect(failures).toEqual([]);
    for (const fragment of requiredSemanticFragments[file]) {
      expect(source).toContain(fragment);
    }
  });

  it('keeps exact fidelity canvas selectors outside the application surface guard', () => {
    const globals = readSource('src/styles/globals.css');
    expect(globals).toMatch(
      /\.sclaw-pptx-host \.pptx-preview-wrapper\s*\{\s*background:\s*#fff;/,
    );
    expect(globals).toMatch(
      /\.sclaw-docx-host \.docx-wrapper > section\.docx\s*\{\s*background:\s*#fff;/,
    );

    const previewSource = readSource('src/components/file-preview/FilePreviewViewer.tsx');
    expect(previewSource).toContain('function isImageFile');
    expect(previewSource).toContain('function isCodeFile');
    expect(previewSource).toContain('function HtmlIframeView');
  });
});
