import { describe, expect, it } from 'vitest';
import {
  middleEllipsisFileName,
  resolveFileTypeIconKind,
} from '@/components/attachments/file-type-icon';

describe('file-type-icon', () => {
  it('maps common extensions to design icon kinds', () => {
    expect(resolveFileTypeIconKind('a.docx')).toBe('word');
    expect(resolveFileTypeIconKind('b.xlsx')).toBe('excel');
    expect(resolveFileTypeIconKind('c.pptx')).toBe('ppt');
    expect(resolveFileTypeIconKind('d.pdf')).toBe('pdf');
    expect(resolveFileTypeIconKind('e.png')).toBe('img');
    expect(resolveFileTypeIconKind('f.md')).toBe('md');
    expect(resolveFileTypeIconKind('g.html')).toBe('html');
    expect(resolveFileTypeIconKind('h.ts')).toBe('code');
    expect(resolveFileTypeIconKind('i.bin')).toBe('other');
  });

  it('middle-ellipsizes long names while keeping extension', () => {
    const name = '店铺库存与销售汇总表_2026年第一季度完整导出数据需要中间省略.docx';
    const shown = middleEllipsisFileName(name);
    expect(shown.length).toBeLessThanOrEqual(name.length);
    expect(shown.endsWith('.docx')).toBe(true);
    expect(shown).toContain('…');
  });

  it('middle-ellipsizes borderline chip-width CJK sketch names', () => {
    const name = '网点管家_个人中心_视觉_田灿阳_20200423.sketch';
    const shown = middleEllipsisFileName(name);
    expect(shown.length).toBeLessThan(name.length);
    expect(shown.endsWith('.sketch')).toBe(true);
    expect(shown).toContain('…');
    expect(shown).not.toMatch(/\.\.\.$/);
  });

  it('never splits emoji surrogate pairs when ellipsizing', () => {
    const name = '月度报表🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉最终版.xlsx';
    const shown = middleEllipsisFileName(name);
    expect(shown.endsWith('.xlsx')).toBe(true);
    expect(shown).toContain('…');
    // 输出不含孤代理（lone surrogate）：按 code point 切割的直接证据
    expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    // 预算按 code point 计：… 前后字符数不超过 maxChars
    expect(Array.from(shown).length).toBeLessThanOrEqual(22);
  });
});
