import { describe, expect, it } from 'vitest';
import {
  applyDisplayNameHints,
  dedupeAttachedFiles,
  previewFileRefsMatch,
} from '@/lib/preview-file-path';
import {
  preferDisplayFileName,
  resolveAttachedFileName,
  stableFileSuffix,
} from '../../shared/file-display-name';
import { extractDisplayFileNameHints } from '@/pages/Chat/message-utils';

describe('file display name helpers', () => {
  it('prefers CJK display labels over mojibake basenames', () => {
    expect(
      preferDisplayFileName('江苏大区健康度_20260625.xlsx', 'ú_20260625.xlsx'),
    ).toBe('江苏大区健康度_20260625.xlsx');
  });

  it('uses media-attached display label when provided', () => {
    expect(
      resolveAttachedFileName(
        '/tmp/ú_20260625.xlsx',
        '江苏大区健康度_20260625.xlsx',
      ),
    ).toBe('江苏大区健康度_20260625.xlsx');
  });

  it('matches files by stable date suffix', () => {
    expect(
      previewFileRefsMatch(
        { fileName: 'ú_20260625.xlsx' },
        { fileName: '江苏大区健康度_20260625.xlsx' },
      ),
    ).toBe(true);
    expect(stableFileSuffix('江苏大区健康度_20260625.xlsx')).toBe('_20260625.xlsx');
  });

  it('dedupes garbled and correct variants keeping readable name', () => {
    const merged = dedupeAttachedFiles([
      {
        filePath: '/tmp/ú_20260625.xlsx',
        fileName: 'ú_20260625.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      {
        filePath: '江苏大区健康度_20260625.xlsx',
        fileName: '江苏大区健康度_20260625.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fileName).toBe('江苏大区健康度_20260625.xlsx');
  });

  it('patches attachment names from assistant text hints', () => {
    const hints = extractDisplayFileNameHints('Excel 文件已生成：\n[江苏大区健康度_20260625.xlsx](preview://tmp/ú_20260625.xlsx)');
    expect(hints).toEqual([{ fileName: '江苏大区健康度_20260625.xlsx' }]);
    const patched = applyDisplayNameHints(
      [{
        filePath: '/tmp/ú_20260625.xlsx',
        fileName: 'ú_20260625.xlsx',
      }],
      hints,
    );
    expect(patched[0]?.fileName).toBe('江苏大区健康度_20260625.xlsx');
  });
});
