import { describe, expect, it } from 'vitest';
import {
  artifactToPreviewFile,
  inferMimeTypeFromPath,
  inferMimeTypeFromUrl,
  isPreviewableRemoteUrl,
  resolvePreviewMimeType,
} from '@/lib/preview-url';

describe('resolvePreviewMimeType', () => {
  it('corrects text/csv to xlsx when path ends with .xlsx', () => {
    const path = '/Users/agent/output/业务量达成情况.xlsx';
    expect(resolvePreviewMimeType('text/csv', path, '业务量达成情况.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('corrects application/octet-stream to docx from extension', () => {
    expect(resolvePreviewMimeType('application/octet-stream', '/tmp/report.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('keeps declared mime when extension is unknown', () => {
    expect(resolvePreviewMimeType('application/json', '/tmp/data.json')).toBe('application/json');
  });

  it('infers xlsx mime from remote URL path', () => {
    const url = 'https://cdn.example.com/reports/summary.xlsx?token=abc';
    expect(inferMimeTypeFromPath(url)).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(resolvePreviewMimeType(inferMimeTypeFromUrl(url, 'csv'), url)).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('marks company *.sto* remote URLs as previewable', () => {
    expect(isPreviewableRemoteUrl('https://cdn.example.sto.cn/a.xlsx')).toBe(true);
    expect(isPreviewableRemoteUrl('https://cdn.example.com/a.xlsx')).toBe(false);
  });
});

describe('artifactToPreviewFile', () => {
  it('uses artifact display name without extension (workflow cards)', () => {
    const file = artifactToPreviewFile({
      name: '客户异常监控报告_20260705',
      type: 'html_report',
      url: 'https://cdn.example.sto.cn/artifacts/preview?token=abc',
    });
    expect(file.fileName).toBe('客户异常监控报告_20260705');
  });

  it('falls back to URL inference when name is the preview placeholder', () => {
    const file = artifactToPreviewFile({
      name: 'preview',
      type: 'html',
      url: 'https://cdn.example.sto.cn/artifacts/preview?token=abc',
    });
    expect(file.fileName).toBe('preview.html');
  });

  it('keeps artifact name when it already includes an extension', () => {
    const file = artifactToPreviewFile({
      name: '申通快递股价分析_20260706.html',
      type: 'html',
      url: 'https://cdn.example.sto.cn/artifacts/preview?token=abc',
    });
    expect(file.fileName).toBe('申通快递股价分析_20260706.html');
  });
});

describe('base64ToUint8Array', () => {
  it('round-trips ascii bytes', async () => {
    const { base64ToUint8Array } = await import('@/lib/preview-binary-load');
    const bytes = base64ToUint8Array(btoa('PK\x03\x04'));
    expect(Array.from(bytes)).toEqual([80, 75, 3, 4]);
  });
});
