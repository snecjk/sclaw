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

const taskSevenSourceFiles = new Set([
  'src/lib/surfaces.ts',
  'src/styles/globals.css',
  'src/components/attachments/ComposerAttachMenu.tsx',
  'src/components/chat/artifact-product-card.tsx',
  'src/components/chat/chat-process-block.tsx',
  'src/components/chat/chat-tool-call-card.tsx',
  'src/components/channels/ChannelConfigModal.tsx',
  'src/components/channels/DingTalkHubBindModal.tsx',
  'src/components/channels/MobileAppConfigModal.tsx',
  'src/components/file-preview/ArtifactShareDialog.tsx',
  'src/components/file-preview/SaveArtifactDialog.tsx',
  'src/components/input-composer/input-composer-agent-picker.tsx',
  'src/components/input-composer/input-composer-shell.tsx',
  'src/components/jsbridge/JsBridgeHostPortal.tsx',
  'src/components/layout/SidebarMobileConnectTooltip.tsx',
  'src/components/layout/TitleBar.tsx',
  'src/components/layout/sidebar-update-notice.tsx',
  'src/components/parameter-form/FormFieldRenderer.tsx',
  'src/components/parameter-form/OptionCardList.tsx',
  'src/components/parameter-form/ParameterFormCard.tsx',
  'src/components/quick-input/QuickInputManageListItem.tsx',
  'src/components/quick-input/QuickInputManageModal.tsx',
  'src/components/quick-input/QuickInputPicker.tsx',
  'src/components/settings/DwsCliSettings.tsx',
  'src/components/settings/ProvidersSettings.tsx',
  'src/components/skill-plaza/SkillIcon.tsx',
  'src/components/ui/confirm-dialog.tsx',
  'src/components/ui/sheet.tsx',
  'src/components/ui/tooltip.tsx',
  'src/pages/Agents/AgentDetailPage.tsx',
  'src/pages/Agents/index.tsx',
  'src/pages/Chat/ChatEngineModelSelectors.tsx',
  'src/pages/Chat/ChatMessage.tsx',
  'src/pages/Chat/ChatSearchBar.tsx',
  'src/pages/Chat/index.tsx',
  'src/pages/Chat/thinking/thinking-turn-process.tsx',
  'src/pages/DataCenter/components/entries.tsx',
  'src/pages/DataCenter/components/modals.tsx',
  'src/pages/Login/index.tsx',
  'src/pages/Models/TokenQuotaDialog.tsx',
  'src/pages/Models/index.tsx',
  'src/pages/Settings/index.tsx',
  'src/pages/Setup/index.tsx',
  'src/pages/Skills/index.tsx',
  'src/pages/Sprite/QuickActions.tsx',
  'src/pages/Sprite/SpriteInput.tsx',
  'src/pages/Sprite/index.tsx',
  'src/pages/Subscriptions/index.tsx',
]);

const taskEightFeatureStylesheets = [
  'src/components/more-apps/more-apps.css',
  'src/components/more-apps/app-plaza-shell.css',
  'src/components/sclaw-browser/sclaw-browser-overlay.css',
  'src/pages/WorkflowDesigner/workflow-designer-canvas.css',
] as const;

const taskEightFeatureComponents = [
  'src/components/more-apps/MoreAppsPage.tsx',
  'src/pages/WorkflowDesigner/workflow-designer.tsx',
  'src/pages/WorkflowDesigner/components/history-versions-drawer.tsx',
  'src/pages/WorkflowDesigner/components/local-run-history-dialog.tsx',
  'src/pages/WorkflowDesigner/components/startup-run-dialog.tsx',
  'src/pages/WorkflowDesigner/components/test-run-trial-view.tsx',
  'src/pages/WorkflowDesigner/components/designer-edge.tsx',
  'src/pages/WorkflowDesigner/components/workflow-canvas-node.tsx',
  'src/pages/MyTask/components/TaskCreateModal.tsx',
  'src/components/workflow/WorkflowPicker.tsx',
] as const;

type TaskSevenViolation = Pick<SourceMatch, 'file' | 'line' | 'value'>;

function isTaskSevenSource(file: string): boolean {
  return taskSevenSourceFiles.has(file);
}

const coolShadowColor = /rgba?\(\s*(?:(?:2\s*(?:,\s*|\s+)8\s*(?:,\s*|\s+)23)|(?:15\s*(?:,\s*|\s+)23\s*(?:,\s*|\s+)42))\b/i;
const brandShadowColor = /(?:rgba?\(\s*255\s*(?:,\s*|\s+)(?:111|140|141|183)\s*(?:,\s*|\s+)(?:0|42|140)\b|hsla?\(\s*(?:1[5-9]|[23]\d|4[0-2])(?:\.\d+)?(?:deg)?\s+(?:8\d|9\d|100)%)/i;
const canonicalShadowProperty = /(?:shadow|ring|glow)/i;
const functionalShadowProperty = /(?:^--ring$|(?:^|-)focus(?:-|$)|(?:^|-)(?:invalid|error)(?:-|$)|(?:^|-)drag-(?:ring|shadow)(?:-|$))/i;
const functionalShadowSelector = /(?::focus(?:-visible|-within)?|:has\([^)]*:focus-visible|\[aria-invalid(?:=['"]true['"])?\]|\[data-variant=['"]error['"]\]|\[data-sto-state=['"](?:focus|drag-over)['"]\])/i;
const explicitArtworkShadowProperty = /^--sto-shadow-voice-/i;
const explicitArtworkShadowSelector = /\.stoclaw-voice(?:-|_)/i;

type CustomPropertyDeclaration = {
  index: number;
  value: string;
};

function customPropertyDeclarations(source: string): Map<string, CustomPropertyDeclaration> {
  const declarations = new Map<string, CustomPropertyDeclaration>();
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], { index: match.index, value: match[2].trim() });
  }
  return declarations;
}

function resolveCustomProperties(
  value: string,
  declarations: ReadonlyMap<string, CustomPropertyDeclaration>,
  seen = new Set<string>(),
): string {
  return value.replace(/var\((--[\w-]+)(?:,[^)]+)?\)/g, (reference, property: string) => {
    if (seen.has(property)) return reference;
    const declaration = declarations.get(property);
    if (!declaration) return reference;
    return resolveCustomProperties(
      declaration.value,
      declarations,
      new Set([...seen, property]),
    );
  });
}

function shadowViolationKind(value: string): 'coolDarkShadow' | 'ordinaryBrandGlow' | null {
  if (coolShadowColor.test(value)) return 'coolDarkShadow';
  if (brandShadowColor.test(value)) return 'ordinaryBrandGlow';
  return null;
}

function recipeSelectorAt(source: string, index: number): string {
  const openBrace = source.lastIndexOf('{', index);
  if (openBrace < 0) return '';
  const previousClose = source.lastIndexOf('}', openBrace);
  return source.slice(previousClose + 1, openBrace).replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

function canonicalShadowViolations(
  tokenSource: string,
  recipeSource: string,
): {
  coolDarkShadow: TaskSevenViolation[];
  ordinaryBrandGlow: TaskSevenViolation[];
} {
  const coolDarkShadow: TaskSevenViolation[] = [];
  const ordinaryBrandGlow: TaskSevenViolation[] = [];
  const declarations = customPropertyDeclarations(tokenSource);

  for (const [property, declaration] of declarations) {
    if (!canonicalShadowProperty.test(property)) continue;
    if (
      functionalShadowProperty.test(property)
      || explicitArtworkShadowProperty.test(property)
    ) continue;
    const resolved = resolveCustomProperties(declaration.value, declarations);
    const kind = shadowViolationKind(resolved);
    if (!kind) continue;
    const violation = {
      file: rawThemeOwner,
      line: lineNumberAt(tokenSource, declaration.index),
      value: `${property}: ${declaration.value}`,
    };
    (kind === 'coolDarkShadow' ? coolDarkShadow : ordinaryBrandGlow).push(violation);
  }

  for (const match of recipeSource.matchAll(/box-shadow\s*:\s*([^;]+);/gi)) {
    const selector = recipeSelectorAt(recipeSource, match.index);
    if (
      functionalShadowSelector.test(selector)
      || explicitArtworkShadowSelector.test(selector)
    ) continue;
    const resolved = resolveCustomProperties(match[1], declarations);
    const kind = shadowViolationKind(resolved);
    if (!kind) continue;
    const violation = {
      file: 'src/styles/theme/recipes.css',
      line: lineNumberAt(recipeSource, match.index),
      value: match[0],
    };
    (kind === 'coolDarkShadow' ? coolDarkShadow : ordinaryBrandGlow).push(violation);
  }

  return { coolDarkShadow, ordinaryBrandGlow };
}

function taskSevenShadowViolations(): {
  coolDarkShadow: TaskSevenViolation[];
  ordinaryBrandGlow: TaskSevenViolation[];
} {
  const coolDarkShadow: TaskSevenViolation[] = [];
  const ordinaryBrandGlow: TaskSevenViolation[] = [];
  const coolDark = /rgba\(\s*2\s*,\s*8\s*,\s*23\s*,[^)]*\)/gi;
  const brandGlow = /(?:box-shadow\s*:|shadow-\[[^\]\n]*)(?:[^;\n]*?)(?:rgba\(\s*255\s*,\s*(?:111|140|141|183)\s*,\s*(?:0|42|140)\s*,[^)]*\)|hsl\(var\(--primary\)\s*\/[^)]*\))/gi;

  const sources = productionSources(sourceRoot);
  const tokenSource = sources.find(({ file }) => file === rawThemeOwner)?.source;
  const recipeSource = sources.find(({ file }) => file === 'src/styles/theme/recipes.css')?.source;
  if (!tokenSource || !recipeSource) throw new Error('Expected canonical theme shadow owners');
  const canonical = canonicalShadowViolations(tokenSource, recipeSource);
  coolDarkShadow.push(...canonical.coolDarkShadow);
  ordinaryBrandGlow.push(...canonical.ordinaryBrandGlow);

  for (const { file, source } of sources) {
    if (!isTaskSevenSource(file)) continue;

    for (const match of source.matchAll(coolDark)) {
      coolDarkShadow.push({
        file,
        line: lineNumberAt(source, match.index),
        value: match[0],
      });
    }

    for (const match of source.matchAll(brandGlow)) {
      const context = exactContext(source, match.index, match[0].length);
      const isFunctionalFeedback = /(?:focus(?:-within|-visible)?|isSearchActive|aria-invalid|error)/i.test(context);
      const isExplicitBrandArtwork = /stoclaw-voice-(?:edge|soundline)-bar/i.test(context);
      if (isFunctionalFeedback || isExplicitBrandArtwork) continue;
      ordinaryBrandGlow.push({
        file,
        line: lineNumberAt(source, match.index),
        value: match[0],
      });
    }
  }

  return { coolDarkShadow, ordinaryBrandGlow };
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
  it('removes reviewed zero-consumer aliases from the canonical token owner', () => {
    const tokenSource = readFileSync(resolve(process.cwd(), rawThemeOwner), 'utf8');
    const deadAliases = [
      '--sto-accent-soft',
      '--sto-border-strong',
      '--sto-color-brand-soft-hsl',
      '--sto-color-brand-strong-hsl',
      '--sto-color-info-soft-hsl',
      '--sto-color-neutral-1-hsl',
      '--sto-color-neutral-10-hsl',
      '--sto-color-neutral-2-hsl',
      '--sto-color-neutral-3-hsl',
      '--sto-color-neutral-4-hsl',
      '--sto-color-neutral-6-hsl',
      '--sto-color-neutral-8-hsl',
      '--sto-color-neutral-9-hsl',
      '--sto-color-surface-page-hsl',
      '--sto-elevated',
      '--sto-info-primary',
      '--sto-warning-primary',
      '--sto-wf-cover-coral-accent',
      '--sto-wf-cover-coral-bg',
      '--sto-wf-cover-coral-icon',
      '--sto-wf-cover-pink-accent',
      '--sto-wf-cover-pink-bg',
      '--sto-wf-cover-pink-icon',
      '--sto-wf-cover-teal-accent',
      '--sto-wf-cover-teal-bg',
      '--sto-wf-cover-teal-icon',
      '--sto-wf-hero-input-border',
      '--sto-wf-hero-input-ring',
    ];

    expect(deadAliases.filter((alias) => tokenSource.includes(`${alias}:`))).toEqual([]);
  });

  it('keeps Task 8 feature stylesheets free of page-owned dark palettes', () => {
    const violations = taskEightFeatureStylesheets.flatMap((file) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      return matchesInSource(file, source)
        .filter((match) => match.rule === 'pageDarkSelector')
        .map(({ file: sourceFile, line, value }) => ({ file: sourceFile, line, value }));
    });

    expect(violations).toEqual([]);
  });

  it('keeps Task 8 feature components free of color-bearing dark utilities', () => {
    const violations = taskEightFeatureComponents.flatMap((file) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      return matchesInSource(file, source)
        .filter((match) => match.rule === 'pageDarkUtility')
        .map(({ file: sourceFile, line, value }) => ({ file: sourceFile, line, value }));
    });

    expect(violations).toEqual([]);
  });

  it('keeps Task 8 artwork data isolated from ordinary UI surfaces and controls', () => {
    const artworkOwners = new Set([
      'src/components/more-apps/more-apps.css',
      'src/pages/WorkflowDesigner/workflow-designer-canvas.css',
    ]);
    const violations = productionSources(sourceRoot)
      .filter(({ file }) => !artworkOwners.has(file))
      .flatMap(({ file, source }) => [...source.matchAll(/--sto-art-[a-z0-9-]+/g)]
        .map((match) => ({ file, line: lineNumberAt(source, match.index), value: match[0] })));

    expect(violations).toEqual([]);

    const moreAppsSource = readFileSync(
      resolve(process.cwd(), 'src/components/more-apps/more-apps.css'),
      'utf8',
    );
    const workflowCanvasSource = readFileSync(
      resolve(process.cwd(), 'src/pages/WorkflowDesigner/workflow-designer-canvas.css'),
      'utf8',
    );
    const tokenSource = readFileSync(resolve(process.cwd(), rawThemeOwner), 'utf8');
    const lightTaskBlock = tokenSource.slice(
      tokenSource.indexOf('    --sto-feature-foreground-strongest:'),
      tokenSource.indexOf('    /* Card roles keep'),
    );
    const taskEightRoleNames = lightTaskBlock.match(/--sto-[a-z0-9-]+(?=:)/g) ?? [];
    const taskEightRoleCounts = new Map<string, number>();
    for (const role of taskEightRoleNames) {
      taskEightRoleCounts.set(role, (taskEightRoleCounts.get(role) ?? 0) + 1);
    }

    expect(tokenSource).not.toContain('--sto-art-');
    expect(taskEightRoleCounts.size).toBeLessThanOrEqual(56);
    expect([...taskEightRoleCounts.values()]).toEqual(
      Array.from({ length: taskEightRoleCounts.size }, () => 1),
    );
    expect((moreAppsSource.match(/--sto-art-[a-z0-9-]+/g) ?? [])
      .every((token) => token.startsWith('--sto-art-app-plaza-'))).toBe(true);
    expect((workflowCanvasSource.match(/--sto-art-[a-z0-9-]+/g) ?? [])
      .every((token) => token.startsWith('--sto-art-workflow-'))).toBe(true);
    expect(`${moreAppsSource}\n${workflowCanvasSource}`).not.toMatch(
      /--sto-art-[a-z0-9-]*(?:surface|control|overlay|feedback)[a-z0-9-]*/,
    );
    expect(moreAppsSource).not.toMatch(
      /--sto-art-app-plaza-(?:hero-cta-view|featured-card|recommended|more-border)/,
    );
    expect(moreAppsSource).toContain('--sto-art-app-plaza-preview-foreground: #111827');
    expect(moreAppsSource).toContain('--sto-art-app-plaza-preview-muted-foreground: #6b7280');
    expect(workflowCanvasSource).toContain('--sto-art-workflow-node-icon-foreground: #1f2937');
    expect(workflowCanvasSource).toContain('--sto-art-workflow-template-output-foreground: #ffffff');

    const approvedMoreAppsArtworkSelectors = new Set([
      '.page-more-apps .app-icon--rounded',
      '.page-more-apps .app-icon--rounded:not(.app-icon--image) svg',
      '.page-more-apps .app-market__hero',
      '.page-more-apps .app-market__hero:hover',
      '.page-more-apps .app-market__hero--org',
      '.page-more-apps .app-market__hero-copy',
      '.page-more-apps .app-market__hero-title-main',
      '.page-more-apps .app-market__hero-title-sub',
      '.page-more-apps .app-market__hero-card',
      '.page-more-apps .app-market__hero-preview',
      '.page-more-apps .app-market__hero-preview-title',
      '.page-more-apps .app-market__hero-preview-tag',
      '.page-more-apps .app-market__hero-stat',
      '.page-more-apps .app-market__hero-stat em',
      '.page-more-apps .app-market__hero-stat strong',
      '.page-more-apps .app-market__hero-dot',
      '.page-more-apps .app-market__hero-dot--active',
      '.page-more-apps .app-market__hero-banner',
      '.page-more-apps .app-market__hero-image-fallback-text',
      '.page-more-apps .app-market__cat-count',
      '.page-more-apps .more-apps-tag--official',
      '.page-more-apps .more-apps-tag--external',
      '.page-more-apps .more-apps-tag--hot',
    ]);
    const approvedWorkflowArtworkSelectors = new Set([
      '.wf-canvas-node-icon',
      '.wf-canvas-node-icon.accent-trigger',
      '.wf-canvas-node-icon.accent-data',
      '.wf-canvas-node-icon.accent-transform',
      '.wf-canvas-node-icon.accent-agent',
      '.wf-canvas-node-icon.accent-condition',
      '.wf-canvas-node-icon.accent-approval',
      '.wf-canvas-node-icon.accent-action',
      '.wf-canvas-node-icon.accent-output',
      '.wf-canvas-node-icon.accent-browser',
      '.workflow-node-library-icon',
      '.workflow-node-library-item.tile-agent:nth-child(1) .workflow-node-library-icon',
      '.workflow-node-library-item.tile-agent:nth-child(2) .workflow-node-library-icon',
      '.workflow-node-library-item.tile-agent:nth-child(3) .workflow-node-library-icon',
      '.workflow-node-library-item.tile-output .workflow-node-library-icon',
      '.workflow-node-library-item.tile-browser .workflow-node-library-icon',
      '.edge-branch-hint',
      '.edge-branch-hint-parallel',
      '.tile-output .template-tile-icon',
    ]);
    const artConsumerSelectors = (source: string) => [...source.matchAll(/([^{}]+)\{([^{}]*var\(--sto-art-[^{}]*)\}/g)]
      .map((match) => match[1]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim());
    const unapprovedMoreAppsSelectors = (source: string) => artConsumerSelectors(source).filter(
      (selector) => !approvedMoreAppsArtworkSelectors.has(selector),
    );
    const unapprovedWorkflowSelectors = (source: string) => artConsumerSelectors(source).filter(
      (selector) => !approvedWorkflowArtworkSelectors.has(selector),
    );

    expect(unapprovedMoreAppsSelectors(moreAppsSource)).toEqual([]);
    expect(unapprovedWorkflowSelectors(workflowCanvasSource)).toEqual([]);
    expect(new Set(artConsumerSelectors(moreAppsSource))).toEqual(approvedMoreAppsArtworkSelectors);
    expect(new Set(artConsumerSelectors(workflowCanvasSource))).toEqual(approvedWorkflowArtworkSelectors);
    expect(unapprovedMoreAppsSelectors(`
      .page-more-apps .app-market__hero-retry {
        background: var(--sto-art-app-plaza-hero-bg);
      }
    `)).toEqual(['.page-more-apps .app-market__hero-retry']);
    expect(unapprovedWorkflowSelectors(`
      .workflow-node-library-item {
        background: var(--sto-art-workflow-parallel-background);
      }
    `)).toEqual(['.workflow-node-library-item']);
  });

  it('keeps Task 8 UI roles consolidated below the reviewed one-off baseline', () => {
    const tokenSource = readFileSync(resolve(process.cwd(), rawThemeOwner), 'utf8');
    const taskBlock = tokenSource.slice(
      tokenSource.indexOf('    --sto-feature-foreground-strongest:'),
      tokenSource.indexOf('    /* Card roles keep'),
    );
    const taskEightRoles = new Set(taskBlock.match(/--sto-[a-z0-9-]+(?=:)/g) ?? []);
    const sourceWithoutTokens = productionSources(sourceRoot)
      .filter(({ file }) => file !== rawThemeOwner)
      .map(({ source }) => source)
      .join('\n');
    const oneConsumerRoles = [...taskEightRoles].filter(
      (role) => sourceWithoutTokens.split(role).length - 1 === 1,
    );
    const unusedRoles = [...taskEightRoles].filter(
      (role) => !sourceWithoutTokens.includes(role),
    );

    expect(taskEightRoles.size).toBeLessThanOrEqual(56);
    expect(oneConsumerRoles.length).toBeLessThanOrEqual(28);
    expect(unusedRoles).toEqual([]);
    expect(tokenSource).not.toContain('--sto-feature-panel-background:');
    expect(tokenSource).not.toContain('--sto-workflow-control-foreground:');
    expect(tokenSource).not.toContain('--sto-workflow-minimap-node-stroke:');
    expect(tokenSource).not.toContain('--sto-workflow-branch-shadow:');
    expect(tokenSource).not.toContain('--sto-workflow-ai-background:');
    expect(tokenSource).not.toContain('--sto-workflow-library-background:');
    expect(tokenSource).not.toContain('--sto-workflow-upload-background:');
    expect(tokenSource).not.toContain('--sto-workflow-upload-border:');
    expect(taskBlock).not.toMatch(
      /--sto-(?:feature-shadow|overlay-(?:dialog-raised|toolbar|popover-strong|warm)-shadow|card-(?:showcase|map|canvas|canvas-selected|upload)-shadow|control-handle-shadow|browser-drawer-shadow|workflow-trial-(?:warning|danger)):/,
    );
    expect(taskBlock).not.toMatch(
      /--sto-(?:app-plaza|workflow)-(?:control|minimap|dialog|upload|node-close|edge-button|library|branch)-(?:background|foreground|border|shadow|hover(?:-background|-foreground|-border)?):/,
    );
  });

  it('rejects cool dark shadows and ordinary brand glows in Task 7 surfaces', () => {
    const violations = taskSevenShadowViolations();

    expect(violations.coolDarkShadow).toEqual([]);
    expect(violations.ordinaryBrandGlow).toEqual([]);
  });

  it('resolves semantic shadows at canonical token and recipe ownership boundaries', () => {
    const violations = canonicalShadowViolations(
      `
        :root {
          --sto-shadow-card: 0 4px 12px rgba(15, 23, 42, 0.12);
          --sto-shadow-brand-card: 0 4px 12px rgba(255, 111, 0, 0.2);
        }
        .dark {
          --sto-shadow-card: 0 4px 12px rgba(2, 8, 23, 0.5);
          --sto-shadow-brand-card: 0 4px 12px rgba(255, 111, 0, 0.2);
        }
      `,
      `
        .sto-card { box-shadow: var(--sto-shadow-card); }
        .sto-overlay { box-shadow: rgba(255, 111, 0, 0.2); }
      `,
    );

    expect(violations.coolDarkShadow).toEqual([
      expect.objectContaining({ file: rawThemeOwner }),
      expect.objectContaining({ file: 'src/styles/theme/recipes.css' }),
    ]);
    expect(violations.ordinaryBrandGlow).toEqual([
      expect.objectContaining({ file: rawThemeOwner }),
      expect.objectContaining({ file: 'src/styles/theme/recipes.css' }),
    ]);
  });

  it('allows light-only semantic shadows and functional or artwork dark feedback', () => {
    const violations = canonicalShadowViolations(
      `
        :root {
          --sto-shadow-card: 0 4px 12px rgba(15, 23, 42, 0.12);
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-voice-line: 0 0 3px rgba(255, 111, 0, 0.2);
        }
        .dark {
          --sto-shadow-card: 0 4px 12px rgba(0, 0, 0, 0.4);
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-voice-line: 0 0 3px rgba(255, 111, 0, 0.2);
        }
      `,
      `
        .sto-card { box-shadow: var(--sto-shadow-card); }
        .sto-control:focus-visible { box-shadow: var(--sto-shadow-focus); }
      `,
    );

    expect(violations).toEqual({ coolDarkShadow: [], ordinaryBrandGlow: [] });
  });

  it('rejects brand shadows hidden behind interactive or ring names', () => {
    const violations = canonicalShadowViolations(
      `
        :root {
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-card-ring: 0 0 0 2px rgba(255, 111, 0, 0.2);
        }
        .dark {
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-card-ring: 0 0 0 2px rgba(255, 111, 0, 0.2);
        }
      `,
      `.sto-card--interactive { box-shadow: var(--sto-shadow-focus); }`,
    );

    expect(violations.coolDarkShadow).toEqual([]);
    expect(violations.ordinaryBrandGlow).toEqual([
      expect.objectContaining({
        file: rawThemeOwner,
        value: '--sto-shadow-card-ring: 0 0 0 2px rgba(255, 111, 0, 0.2)',
      }),
      expect.objectContaining({ file: 'src/styles/theme/recipes.css' }),
    ]);
  });

  it('allows genuine focus, error, and explicit brand artwork shadows', () => {
    const violations = canonicalShadowViolations(
      `
        :root {
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-error: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-voice-line: 0 0 3px rgba(255, 111, 0, 0.2);
        }
        .dark {
          --sto-shadow-focus: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-error: 0 0 0 2px rgba(255, 111, 0, 0.2);
          --sto-shadow-voice-line: 0 0 3px rgba(255, 111, 0, 0.2);
        }
      `,
      `
        .sto-control:focus-visible { box-shadow: var(--sto-shadow-focus); }
        .sto-feedback[aria-invalid='true'] { box-shadow: var(--sto-shadow-error); }
        .stoclaw-voice-art { box-shadow: var(--sto-shadow-voice-line); }
      `,
    );

    expect(violations).toEqual({ coolDarkShadow: [], ordinaryBrandGlow: [] });
  });

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
