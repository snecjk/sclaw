import { describe, expect, it } from 'vitest';
import { extractPreviewableRefs, extractPreviewPathFromLine } from '@/pages/Chat/message-utils';
import { mergePreviewFileLists, normalizePreviewFileKey } from '@/lib/preview-file-path';

const WIN_PATH = String.raw`C:\Users\admin\.openclaw\workspace\output\总部结算对账分析_日_20260623_0938.html`;

describe('Windows markdown path extraction', () => {
  it('extracts backtick-wrapped path after Chinese label', () => {
    const line = `- 📄 报告文件：\`${WIN_PATH}\``;
    expect(extractPreviewPathFromLine(line)).toBe(WIN_PATH);
  });

  it('dedupes attached backslash path with text-extracted forward-slash path', () => {
    const markdown = `报告已生成\n- 📄 报告文件：\`${WIN_PATH}\``;
    const refs = extractPreviewableRefs(markdown);
    expect(refs.length).toBeGreaterThan(0);

    const attached = [{
      fileName: '总部结算对账分析_日_20260623_0938.html',
      filePath: WIN_PATH,
      fileSize: 13_190_000,
      preview: null,
      mimeType: 'text/html',
    }];
    const merged = mergePreviewFileLists(
      attached,
      refs.map((r) => ({ ...r, fileSize: 0, preview: null })),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fileSize).toBe(13_190_000);
    expect(normalizePreviewFileKey(attached[0].filePath)).toBe(
      normalizePreviewFileKey(refs[0]!.filePath),
    );
  });
});
