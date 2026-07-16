import { describe, expect, it } from 'vitest';
import {
  filterSkillsByQuery,
  splitHighlightSegments,
  type SkillPickerItem,
} from '@/lib/skill-picker-filter';

const SAMPLE_SKILLS: SkillPickerItem[] = [
  { slug: 'a', title: '异常客户跟踪', description: '监控异常客户' },
  { slug: 'b', title: '申通知识库查询', description: '知识库问答' },
  { slug: 'c', title: '网络治理', description: '低星网点与异常网点分布' },
];

describe('skill-picker-filter', () => {
  it('returns all skills when query is empty', () => {
    expect(filterSkillsByQuery(SAMPLE_SKILLS, '')).toHaveLength(3);
    expect(filterSkillsByQuery(SAMPLE_SKILLS, '   ')).toHaveLength(3);
  });

  it('filters by title case-insensitively', () => {
    const result = filterSkillsByQuery(SAMPLE_SKILLS, '异常');
    expect(result.map((s) => s.slug)).toEqual(['a', 'c']);
  });

  it('filters by description', () => {
    const result = filterSkillsByQuery(SAMPLE_SKILLS, '知识库');
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('b');
  });

  it('splitHighlightSegments marks matching substrings', () => {
    const segments = splitHighlightSegments('异常客户跟踪', '异常');
    expect(segments).toEqual([
      { text: '异常', highlight: true },
      { text: '客户跟踪', highlight: false },
    ]);
  });

  it('splitHighlightSegments finds multiple matches', () => {
    const segments = splitHighlightSegments('异常与异常处理', '异常');
    expect(segments).toEqual([
      { text: '异常', highlight: true },
      { text: '与', highlight: false },
      { text: '异常', highlight: true },
      { text: '处理', highlight: false },
    ]);
  });

  it('splitHighlightSegments is case-insensitive', () => {
    const segments = splitHighlightSegments('ABCabc', 'ab');
    expect(segments.some((s) => s.highlight && s.text === 'AB')).toBe(true);
    expect(segments.some((s) => s.highlight && s.text === 'ab')).toBe(true);
  });
});
