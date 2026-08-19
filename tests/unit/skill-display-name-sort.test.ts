import { describe, expect, it } from 'vitest';
import {
  compareSkillDisplayNames,
  getSkillDisplayNameSortGroup,
  sortSkillsByDisplayName,
} from '@/lib/skill-display-name-sort';

describe('skill-display-name-sort', () => {
  it('classifies first character into chinese / latin / other', () => {
    expect(getSkillDisplayNameSortGroup('申通知识库')).toBe('chinese');
    expect(getSkillDisplayNameSortGroup('AI助手')).toBe('latin');
    expect(getSkillDisplayNameSortGroup('Zebra')).toBe('latin');
    expect(getSkillDisplayNameSortGroup('123报表')).toBe('other');
    expect(getSkillDisplayNameSortGroup('#标签')).toBe('other');
    expect(getSkillDisplayNameSortGroup('  网络治理')).toBe('chinese');
    expect(getSkillDisplayNameSortGroup('')).toBe('other');
  });

  it('orders chinese before latin before other', () => {
    expect(compareSkillDisplayNames('网络', 'Apple')).toBeLessThan(0);
    expect(compareSkillDisplayNames('Apple', '1号')).toBeLessThan(0);
    expect(compareSkillDisplayNames('1号', '网络')).toBeGreaterThan(0);
  });

  it('sorts mixed list: chinese (pinyin) → latin A–Z → digits/symbols', () => {
    const sorted = sortSkillsByDisplayName([
      { slug: 'z', title: 'Zebra' },
      { slug: 'num', title: '9日报' },
      { slug: 'sym', title: '#标签' },
      { slug: 'ai', title: 'AI助手' },
      { slug: 'wang', title: '网络治理' },
      { slug: 'shen', title: '申通知识库' },
      { slug: 'yi', title: '异常客户跟踪' },
    ]);

    expect(sorted.map((s) => s.slug)).toEqual([
      'shen', // 申 shen
      'wang', // 网 wang
      'yi', // 异 yi
      'ai', // A
      'z', // Z
      'sym', // #
      'num', // 9
    ]);
  });

  it('is case-insensitive within latin group', () => {
    const sorted = sortSkillsByDisplayName([
      { slug: 'b', title: 'beta' },
      { slug: 'a', title: 'Alpha' },
    ]);
    expect(sorted.map((s) => s.slug)).toEqual(['a', 'b']);
  });

  it('uses slug as stable tiebreaker', () => {
    const sorted = sortSkillsByDisplayName([
      { slug: 'b', title: '同名' },
      { slug: 'a', title: '同名' },
    ]);
    expect(sorted.map((s) => s.slug)).toEqual(['a', 'b']);
  });
});
