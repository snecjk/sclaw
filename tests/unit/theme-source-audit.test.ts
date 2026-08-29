import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Rule = keyof typeof forbiddenPatterns;

type SourceMatch = {
  file: string;
  line: number;
  rule: Rule;
  value: string;
  context: string;
  key: string;
};

const sourceRoot = resolve(process.cwd(), 'src');
const auditedExtensions = new Set(['.css', '.ts', '.tsx', '.svg']);
const rawThemeOwner = 'src/styles/theme/tokens.css';
const selectorOwners = new Set([
  rawThemeOwner,
  'src/styles/theme/recipes.css',
]);

const forbiddenPatterns = {
  pageDarkUtility: /dark:(?:bg|text|border|shadow|ring)-/,
  pageDarkSelector: /^\s*\.dark\b/m,
  coolDarkShadow: /rgba\(\s*(?:2\s*,\s*8\s*,\s*23|15\s*,\s*23\s*,\s*42)/,
  rawColor: /#[\da-fA-F]{3,8}\b|(?:rgb|hsl)a?\(/,
} as const;

function productionSources(directory: string): Array<{ file: string; source: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return productionSources(absolutePath);
      if (!auditedExtensions.has(extname(entry.name))) return [];
      return [{
        file: relative(process.cwd(), absolutePath).replaceAll('\\', '/'),
        source: readFileSync(absolutePath, 'utf8'),
      }];
    });
}

function exactContext(source: string, index: number, length: number): string {
  const start = Math.max(0, index - 72);
  const end = Math.min(source.length, index + length + 72);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function shouldAudit(rule: Rule, file: string): boolean {
  if (rule === 'rawColor' && file === rawThemeOwner) return false;
  if (rule === 'pageDarkSelector' && selectorOwners.has(file)) return false;
  return true;
}

function sourceMatches(): SourceMatch[] {
  const duplicateCounts = new Map<string, number>();

  return productionSources(sourceRoot).flatMap(({ file, source }) =>
    (Object.entries(forbiddenPatterns) as Array<[Rule, RegExp]>).flatMap(([rule, pattern]) => {
      if (!shouldAudit(rule, file)) return [];

      const matcher = new RegExp(pattern.source, `${pattern.flags.replace('m', '')}gm`);
      return [...source.matchAll(matcher)].map((match) => {
        const value = match[0].trim();
        const context = exactContext(source, match.index, match[0].length);
        const baseKey = `${file}::${rule}::${value}::${context}`;
        const duplicateOrdinal = (duplicateCounts.get(baseKey) ?? 0) + 1;
        duplicateCounts.set(baseKey, duplicateOrdinal);

        return {
          file,
          line: lineNumberAt(source, match.index),
          rule,
          value,
          context,
          key: `${baseKey}::${duplicateOrdinal}`,
        };
      });
    }),
  );
}

function formatMatches(matches: readonly SourceMatch[]): string {
  const counts = Object.fromEntries(
    Object.keys(forbiddenPatterns).map((rule) => [
      rule,
      matches.filter((match) => match.rule === rule).length,
    ]),
  );
  const details = matches.map(
    ({ file, line, rule, value, context }) =>
      `${file}:${line} [${rule}] ${JSON.stringify(value)} | ${context.slice(0, 180)}`,
  );
  return [`Theme source violations: ${JSON.stringify(counts)}`, ...details].join('\n');
}

const approvedBrandStatusValues = new Set([
  '#ff6f00',
  '#4760fe',
  '#00b54b',
  '#fa3c3c',
  '#faad14',
]);

function reasonFor(match: SourceMatch): string {
  if (match.rule === 'pageDarkUtility') {
    return 'Migration debt: local color-bearing dark utility must move to semantic recipes in Tasks 6-8.';
  }
  if (match.rule === 'pageDarkSelector') {
    return 'Migration debt: ordinary CSS dark selector must move to semantic tokens or recipes in Tasks 7-8.';
  }
  if (match.rule === 'coolDarkShadow') {
    return 'Migration debt: cool blue-black shadow must move to a neutral semantic shadow in Task 7.';
  }
  if (match.file.endsWith('.svg')) {
    return 'Fidelity asset exception: this exact authored SVG color is preserved and reviewed independently of the app theme palette.';
  }
  if (match.context.includes('var(--')) {
    return 'Semantic reference exception: the broad raw-color regex sees a CSS color function whose value comes from a theme variable.';
  }
  if (approvedBrandStatusValues.has(match.value.toLowerCase())) {
    return 'Brand/status exception: this exact approved functional or brand literal is not an ordinary neutral surface.';
  }
  if (match.file === 'src/lib/preview-srcdoc.ts') {
    return 'Migration debt: the duplicated adaptive preview palette is removed when preview imports canonical tokens in Task 4.';
  }
  return 'Migration debt: this exact raw color occurrence must be classified or replaced by a semantic token in Tasks 4-10.';
}

describe('repository-wide theme source audit', () => {
  it('rejects changes outside the exact reviewed migration snapshot', () => {
    const matches = sourceMatches();
    const snapshotEntries = matches.map((match) => ({
      key: match.key,
      reason: reasonFor(match),
    }));

    expect(snapshotEntries, formatMatches(matches)).toMatchSnapshot();
  });

  it('keeps every migration exception exact, reasoned, and still in use', () => {
    const matches = sourceMatches();
    const entries = matches.map((match) => ({ key: match.key, reason: reasonFor(match) }));
    const duplicateKeys = entries
      .map((entry) => entry.key)
      .filter((key, index, keys) => keys.indexOf(key) !== index);
    const missingReasons = entries.filter((entry) => entry.reason.trim().length < 12);

    expect(duplicateKeys, 'Duplicate allowlist keys hide debt accounting errors').toEqual([]);
    expect(missingReasons, 'Every exception needs a specific review reason').toEqual([]);
  });

  it('ports the legacy blue-black dark utility coverage', () => {
    const legacyCoolDark = /dark:[^\s'"`]*\[#(?:131a24|0f172a|111827|1f2937|1e293b|252a2e|343a40|46515a|2e3038|a8b8c8)\]/gi;
    const failures = productionSources(sourceRoot).flatMap(({ file, source }) =>
      [...source.matchAll(legacyCoolDark)].map((match) => ({
        file,
        line: lineNumberAt(source, match.index),
        value: match[0],
      })),
    );

    expect(failures).toEqual([]);
  });
});
