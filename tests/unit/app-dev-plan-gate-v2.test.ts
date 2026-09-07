import { describe, expect, it } from 'vitest';
import {
  buildPlanConfirmPrompt,
  extractSclawPlan,
  extractSclawStyles,
} from '../../src/lib/app-dev-plan-gate';
import { deriveAppNameFromPrompt } from '../../src/lib/app-dev-quick-create';

describe('app-dev-plan-gate v2', () => {
  it('parses overview/audience/scenarios and styles', () => {
    const text = [
      '```sclaw_plan',
      JSON.stringify({
        summary: '做一个查询页',
        overview: '快递查询',
        audience: '网点小件员',
        scenarios: '扫码查轨迹',
        steps: [{ id: '1', title: '首页', assets: ['主视觉'] }],
      }),
      '```',
      '```sclaw_styles',
      JSON.stringify({
        presets: [{ id: 'a', name: '清爽', swatches: ['#fff', '#000'] }],
      }),
      '```',
    ].join('\n');

    const plan = extractSclawPlan(text);
    expect(plan?.overview).toBe('快递查询');
    expect(plan?.audience).toBe('网点小件员');
    expect(plan?.steps[0]?.assets).toEqual(['主视觉']);

    const styles = extractSclawStyles(text);
    expect(styles?.[0]).toMatchObject({ id: 'a', name: '清爽' });

    const prompt = buildPlanConfirmPrompt(plan!, { style: styles![0]! });
    expect(prompt).toContain('【应用概述】');
    expect(prompt).toContain('【设计风格】');
    expect(prompt).toContain('清爽');
  });
});

describe('deriveAppNameFromPrompt', () => {
  it('strips common prefixes and caps length', () => {
    expect(deriveAppNameFromPrompt('帮我做一个快递查询助手')).toContain('快递');
    expect(deriveAppNameFromPrompt('a'.repeat(40)).length).toBeLessThanOrEqual(16);
  });
});
