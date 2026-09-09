import { describe, expect, it } from 'vitest';
import {
  extractSclawSuggestions,
  buildFallbackSuggestions,
} from '@/components/app-dev/AppDevSuggestionChips';
import {
  formatOklch,
  formatRem,
  hexToOklch,
  parseColorToOklch,
  parseRem,
  normalizeDesignTokensContract,
} from '@/lib/app-dev-tune-tokens';
import {
  buildElementIntentPrompt,
  parseAppDevElementIntent,
} from '@/lib/app-dev-element-intent';

describe('app-dev tune tokens helpers', () => {
  it('parses oklch and hex', () => {
    expect(parseColorToOklch('oklch(0.7 0.15 50)')).toEqual({ l: 0.7, c: 0.15, h: 50 });
    const fromHex = hexToOklch('#FF6700');
    expect(fromHex).not.toBeNull();
    expect(fromHex!.l).toBeGreaterThan(0.2);
    expect(fromHex!.c).toBeGreaterThan(0);
    expect(formatOklch({ l: 0.5, c: 0.1, h: 40 })).toContain('oklch(');
  });

  it('parses rem / px radius', () => {
    expect(parseRem('0.5rem')).toBe(0.5);
    expect(parseRem('8px')).toBe(0.5);
    expect(formatRem(0.5)).toBe('0.5rem');
  });

  it('normalizes design token contract', () => {
    const contract = normalizeDesignTokensContract({
      schemaVersion: 1,
      source: 'src/theme/theme.css',
      tokens: [
        { name: '--sto-color-primary', label: '主题色', type: 'color', group: '颜色', format: 'oklch' },
        { name: 'bad', label: 'x', type: 'color' },
      ],
    });
    expect(contract?.tokens).toHaveLength(1);
    expect(contract?.tokens[0].name).toBe('--sto-color-primary');
  });
});

describe('app-dev suggestions / element intent', () => {
  it('extracts sclaw_suggestions fence', () => {
    const text = 'done\n```sclaw_suggestions\n[{"label":"移动端","prompt":"检查移动端"}]\n```\n';
    expect(extractSclawSuggestions(text)).toEqual([
      { label: '移动端', prompt: '检查移动端' },
    ]);
  });

  it('builds fallback suggestions', () => {
    expect(buildFallbackSuggestions({ changedStyles: true })[0].label).toContain('移动端');
    expect(buildFallbackSuggestions({ changedData: true })[0].label).toContain('空态');
  });

  it('builds element intent prompt', () => {
    const prompt = buildElementIntentPrompt('把按钮改大', [
      { selector: '#submit', tag: 'button', text: '提交', styles: { color: 'red' } },
    ]);
    expect(prompt).toContain('#submit');
    expect(prompt).toContain('把按钮改大');
    expect(prompt).toContain('sclaw_element_intent');
    const parsed = parseAppDevElementIntent(prompt);
    expect(parsed).toEqual({
      intent: '把按钮改大',
      elements: [{ selector: '#submit', tag: 'button', text: '提交' }],
    });
  });

  it('parses legacy element intent prompts without the fence', () => {
    const legacy = [
      '请只修改下列选中元素相关代码，不要改动无关区域。',
      '1. 选择器 `#hero`（h1 / "山丘咖啡"）；当前样式摘要：{}',
      '修改意图：字体颜色改成红色',
    ].join('\n');
    expect(parseAppDevElementIntent(legacy)).toEqual({
      intent: '字体颜色改成红色',
      elements: [{ selector: '#hero', tag: 'h1', text: '山丘咖啡' }],
    });
  });
});
