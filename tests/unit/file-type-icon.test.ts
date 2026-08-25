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
    const shown = middleEllipsisFileName(name, 32);
    expect(shown.length).toBeLessThanOrEqual(32);
    expect(shown.endsWith('.docx')).toBe(true);
    expect(shown).toContain('…');
  });
});
