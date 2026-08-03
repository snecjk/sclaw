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

  it('keeps a local workflow artifact path for native file actions', () => {
    const file = artifactToPreviewFile({
      name: 'report.html',
      type: 'html',
      url: 'file:///C:/Users/test/.stoclaw/workflow-runtime/workspaces/run-1/report.html',
      filePath: 'C:\\Users\\test\\.stoclaw\\workflow-runtime\\workspaces\\run-1\\report.html',
    });
    expect(file.filePath).toBe('C:\\Users\\test\\.stoclaw\\workflow-runtime\\workspaces\\run-1\\report.html');
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

  it('extracts filePath query param from agentrun preview URLs', () => {
    const previewUrl = 'https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=agentRun/432100/outputs/%E5%AE%A2%E6%88%B7%E5%BC%82%E5%B8%B8%E7%9B%91%E6%8E%A720260707_092051.html&expireAt=1786065685559&sign=738cb62116df1a29067784619dd5a15e';
    const file = artifactToPreviewFile({
      name: 'preview',
      type: 'html_report',
      url: previewUrl,
    });
    expect(file.fileName).toBe('客户异常监控20260707_092051.html');
  });

  it('uses extensionless filePath basename and appends html extension from mime', () => {
    const previewUrl = 'https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=agentRun/432100/outputs/%E5%AE%A2%E6%88%B7%E5%BC%82%E5%B8%B8%E7%9B%91%E6%8E%A720260707_092051&sign=1';
    const file = artifactToPreviewFile({
      name: 'preview',
      type: 'html_report',
      url: previewUrl,
    });
    expect(file.fileName).toBe('客户异常监控20260707_092051.html');
  });

  it('prefers artifact display name over agentrun preview URL filePath', () => {
    const previewUrl = 'https://baseinfo-chatbotapi.sto.cn/api/agentrun/artifact/preview?filePath=agentRun/432100/outputs/report.html&sign=1';
    const file = artifactToPreviewFile({
      name: '客户异常监控报告_20260707',
      type: 'html_report',
      url: previewUrl,
    });
    expect(file.fileName).toBe('客户异常监控报告_20260707');
  });
});

describe('base64ToUint8Array', () => {
  it('round-trips ascii bytes', async () => {
    const { base64ToUint8Array } = await import('@/lib/preview-binary-load');
    const bytes = base64ToUint8Array(btoa('PK\x03\x04'));
    expect(Array.from(bytes)).toEqual([80, 75, 3, 4]);
  });
});
