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
  pageDarkSelector: /^[\t ]*\.dark\b/m,
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

function completeColorFunction(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1;
    if (source[index] !== ')') continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start, source.indexOf('\n', start) === -1 ? source.length : source.indexOf('\n', start));
}

function matchedValue(rule: Rule, source: string, match: RegExpMatchArray): string {
  if (rule === 'rawColor' && /^(?:rgb|hsl)a?\($/i.test(match[0])) {
    return completeColorFunction(source, match.index);
  }
  return match[0].trim();
}

function shouldAudit(rule: Rule, file: string): boolean {
  if (rule === 'rawColor' && file === rawThemeOwner) return false;
  if (rule === 'pageDarkSelector' && selectorOwners.has(file)) return false;
  return true;
}

function matchesInSource(file: string, source: string): SourceMatch[] {
  const duplicateCounts = new Map<string, number>();

  return (Object.entries(forbiddenPatterns) as Array<[Rule, RegExp]>).flatMap(([rule, pattern]) => {
    if (!shouldAudit(rule, file)) return [];

    const matcher = new RegExp(pattern.source, `${pattern.flags.replace('m', '')}gm`);
    return [...source.matchAll(matcher)].map((match) => {
      const value = matchedValue(rule, source, match);
      const context = exactContext(source, match.index, value.length);
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
  });
}

function sourceMatches(): SourceMatch[] {
  return productionSources(sourceRoot).flatMap(({ file, source }) => matchesInSource(file, source));
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

const authoredSvgExceptions: Readonly<Record<string, string>> = {
  'src/assets/SClawlogo.svg': 'Authored SClaw brand mark; its exact embedded artwork colors are not app surface mappings.',
  'src/assets/SClawlogo_black.svg': 'Authored SClaw monochrome brand mark; its exact artwork colors are preserved.',
  'src/assets/logo.svg': 'Authored product logo; its exact embedded artwork colors are preserved.',
  'src/assets/sidebar-logo.svg': 'Authored sidebar brand mark for the light appearance; exact artwork colors are preserved.',
  'src/assets/sidebar-logo-dark.svg': 'Authored sidebar brand mark for the dark appearance; exact artwork colors are preserved.',
  'src/assets/channels/dingtalk.svg': 'Third-party DingTalk brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/discord.svg': 'Third-party Discord brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/qq.svg': 'Third-party QQ brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/telegram.svg': 'Third-party Telegram brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/wechat.svg': 'Third-party WeChat brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/wecom.svg': 'Third-party WeCom brand asset; exact vendor artwork colors are preserved.',
  'src/assets/channels/whatsapp.svg': 'Third-party WhatsApp brand asset; exact vendor artwork colors are preserved.',
  'src/assets/providers/anthropic.svg': 'Third-party Anthropic provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/ark.svg': 'Third-party Ark provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/custom.svg': 'Authored custom-provider identity asset; exact artwork colors are preserved.',
  'src/assets/providers/google.svg': 'Third-party Google provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/minimax.svg': 'Third-party MiniMax provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/moonshot.svg': 'Third-party Moonshot provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/openai.svg': 'Third-party OpenAI provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/openrouter.svg': 'Third-party OpenRouter provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/qwen.svg': 'Third-party Qwen provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/siliconflow.svg': 'Third-party SiliconFlow provider mark; exact vendor artwork colors are preserved.',
  'src/assets/providers/sto.svg': 'Authored STO provider mark; exact brand artwork colors are preserved.',
  'src/assets/learning-center/case-empty-icon.svg': 'Authored learning-center empty-state illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/category-advanced-card.svg': 'Authored learning-center category illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/category-organization-card.svg': 'Authored learning-center category illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/category-profit-loss-card.svg': 'Authored learning-center category illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/category-quotation-card.svg': 'Authored learning-center category illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/category-reconciliation-card.svg': 'Authored learning-center category illustration; exact artwork colors are Fidelity content.',
  'src/assets/learning-center/title-step-underline.svg': 'Authored learning-center decorative illustration; exact artwork colors are Fidelity content.',
};

const reviewedBrandStatusExceptions = [
  {
    file: 'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx',
    value: '#FAAD14',
    context: "cancelled: 'text-[#FAAD14]',",
    reason: 'Brand/status exception: exact cancelled-state warning literal in the trial status map.',
  },
  {
    file: 'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx',
    value: '#FA3C3C',
    context: "failed: 'text-[#FA3C3C]',",
    reason: 'Brand/status exception: exact failed-state danger literal in the trial status map.',
  },
  {
    file: 'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx',
    value: '#00B54B',
    context: "completed: 'text-[#00B54B]',",
    reason: 'Brand/status exception: exact completed-state success literal in the trial status map.',
  },
] as const;

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
  const authoredSvgReason = authoredSvgExceptions[match.file];
  if (authoredSvgReason) {
    return `Fidelity asset exception: ${authoredSvgReason}`;
  }
  if (/^(?:rgb|hsl)a?\(/i.test(match.value) && match.value.includes('var(--')) {
    return 'Semantic reference exception: the broad raw-color regex sees a CSS color function whose value comes from a theme variable.';
  }
  const reviewedBrandStatus = reviewedBrandStatusExceptions.find((entry) =>
    entry.file === match.file
      && entry.value === match.value
      && match.context.includes(entry.context),
  );
  if (reviewedBrandStatus) {
    return reviewedBrandStatus.reason;
  }
  if (match.file === 'src/lib/preview-srcdoc.ts') {
    return 'Migration debt: the duplicated adaptive preview palette is removed when preview imports canonical tokens in Task 4.';
  }
  return 'Migration debt: this exact raw color occurrence must be classified or replaced by a semantic token in Tasks 4-10.';
}

describe('repository-wide theme source audit', () => {
  it('classifies exceptions from the matched value and exact reviewed source', () => {
    const rawMatch = (file: string, value: string, context: string): SourceMatch => ({
      file,
      line: 1,
      rule: 'rawColor',
      value,
      context,
      key: `${file}::rawColor::${value}::${context}::1`,
    });

    expect(reasonFor(rawMatch(
      'src/pages/example.tsx',
      '#ffffff',
      'color: hsl(var(--foreground)); background: #ffffff;',
    ))).toMatch(/^Migration debt:/);
    expect(reasonFor(rawMatch(
      'src/pages/example.css',
      'hsl(var(--foreground))',
      'color: hsl(var(--foreground));',
    ))).toMatch(/^Semantic reference exception:/);
    expect(reasonFor(rawMatch(
      'src/pages/example.css',
      'rgba(var(--overlay-rgb), 0.5)',
      'background: rgba(var(--overlay-rgb), 0.5);',
    ))).toMatch(/^Semantic reference exception:/);
    expect(reasonFor(rawMatch(
      'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx',
      '#FAAD14',
      "cancelled: 'text-[#FAAD14]',",
    ))).toMatch(/^Brand\/status exception:/);
    expect(reasonFor(rawMatch(
      'src/pages/example.tsx',
      '#FAAD14',
      "className='text-[#FAAD14]'",
    ))).toMatch(/^Migration debt:/);
    expect(reasonFor(rawMatch(
      'src/assets/providers/openai.svg',
      '#000000',
      'fill="#000000"',
    ))).toMatch(/^Fidelity asset exception:/);
    expect(reasonFor(rawMatch(
      'src/assets/icons/add.svg',
      '#1D2129',
      'fill="#1D2129"',
    ))).toMatch(/^Migration debt:/);

    const semanticMatches = matchesInSource(
      'src/pages/example.css',
      '.example { color: hsl(var(--foreground)); background: rgba(var(--overlay-rgb), 0.5); }',
    ).filter((match) => match.rule === 'rawColor');
    expect(semanticMatches.map((match) => match.value)).toEqual([
      'hsl(var(--foreground))',
      'rgba(var(--overlay-rgb), 0.5)',
    ]);
    expect(semanticMatches.map(reasonFor)).toEqual([
      expect.stringMatching(/^Semantic reference exception:/),
      expect.stringMatching(/^Semantic reference exception:/),
    ]);
  });

  it('reports a dark selector on its exact source line', () => {
    const source = 'preceding declaration\n  \n  .dark .example { color: white; }\nfollowing declaration';
    const match = matchesInSource('src/pages/example.css', source)
      .find((candidate) => candidate.rule === 'pageDarkSelector');

    expect(match).toMatchObject({
      file: 'src/pages/example.css',
      line: 3,
      rule: 'pageDarkSelector',
      value: '.dark',
    });
    expect(formatMatches([match!])).toContain('src/pages/example.css:3 [pageDarkSelector] ".dark"');
  });

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
