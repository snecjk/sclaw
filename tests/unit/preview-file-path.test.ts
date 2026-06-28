import { describe, expect, it } from 'vitest';
import {
  dedupeAttachedFiles,
  mergePreviewFileLists,
  normalizePreviewFileKey,
  previewFileRefsMatch,
} from '@/lib/preview-file-path';

describe('preview-file-path', () => {
  it('normalizes windows and posix paths to the same key', () => {
    const win = String.raw`C:\Users\admin\output\report.html`;
    const posix = 'C:/Users/admin/output/report.html';
    expect(normalizePreviewFileKey(win)).toBe(normalizePreviewFileKey(posix));
  });

  it('matches attached file and extracted ref for the same artifact', () => {
    const attached = {
      filePath: String.raw`C:\Users\admin\output\总部结算对账分析_日_20260623_0938.html`,
      fileName: '总部结算对账分析_日_20260623_0938.html',
    };
    const extracted = {
      filePath: 'C:/Users/admin/output/总部结算对账分析_日_20260623_0938.html',
      fileName: '总部结算对账分析_日_20260623_0938.html',
    };
    expect(previewFileRefsMatch(attached, extracted)).toBe(true);
  });

  it('dedupes attached files and keeps richer metadata', () => {
    const deduped = dedupeAttachedFiles([
      {
        fileName: 'report.html',
        filePath: String.raw`C:\out\report.html`,
        fileSize: 13_190_000,
        preview: null,
        mimeType: 'text/html',
      },
      {
        fileName: 'report.html',
        filePath: 'C:/out/report.html',
        fileSize: 0,
        preview: null,
        mimeType: 'text/html',
      },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.fileSize).toBe(13_190_000);
  });

  it('mergePreviewFileLists prefers attached metadata over text refs', () => {
    const merged = mergePreviewFileLists(
      [{
        fileName: 'report.html',
        filePath: String.raw`C:\out\report.html`,
        fileSize: 13_190_000,
        preview: null,
        mimeType: 'text/html',
      }],
      [{
        fileName: 'report.html',
        filePath: 'C:/out/report.html',
        fileSize: 0,
        preview: null,
        mimeType: 'text/html',
      }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.fileSize).toBe(13_190_000);
  });

  it('drops truncated local path when full html sibling exists', () => {
    const deduped = dedupeAttachedFiles([
      {
        fileName: '申通快递分析',
        filePath: '/Users/sto/.claw-output/申通快递分析',
        fileSize: 0,
        preview: null,
        mimeType: 'application/octet-stream',
      },
      {
        fileName: '申通快递分析 -20260628.html',
        filePath: '/Users/sto/.claw-output/申通快递分析 -20260628.html',
        fileSize: 0,
        preview: null,
        mimeType: 'text/html',
      },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.mimeType).toBe('text/html');
  });
});
