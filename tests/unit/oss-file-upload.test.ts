import { describe, expect, it } from 'vitest';
import {
  buildOssFileUploadCurl,
  parseOssFileUploadPayload,
  resourceIdFromOssKey,
} from '../../electron/utils/oss-temp-upload';

describe('resourceIdFromOssKey', () => {
  it('returns last path segment', () => {
    expect(resourceIdFromOssKey('temp/uploads/1770000000000_report.xlsx')).toBe(
      '1770000000000_report.xlsx',
    );
  });
});

describe('buildOssFileUploadCurl', () => {
  it('matches agent-oss-file-api.md multipart fields', () => {
    const curl = buildOssFileUploadCurl({
      baseUrl: 'https://baseinfo-aimemory-test.sto.cn',
      token: 'test-token',
      filePath: '/tmp/report.xlsx',
      bizTypeEnum: 'temp',
      expiresSeconds: 86400,
    });
    expect(curl).toContain('POST \'https://baseinfo-aimemory-test.sto.cn/agent/v1/oss-file/upload\'');
    expect(curl).toContain('stotoken: test-token');
    expect(curl).toContain('file=@/tmp/report.xlsx');
    expect(curl).toContain('biz_type_enum=temp');
    expect(curl).toContain('expires_seconds=86400');
  });
});

describe('parseOssFileUploadPayload', () => {
  it('parses standard success envelope', () => {
    const result = parseOssFileUploadPayload({
      success: true,
      data: {
        ossKey: 'temp/uploads/1770000000000_report.xlsx',
        tempUrl: 'https://oss.example.com/report.xlsx?sig=1',
        fileType: 'xlsx',
        name: 'report.xlsx',
      },
      traceId: 'trace-1',
    });
    expect(result.tempUrl).toContain('oss.example.com');
    expect(result.resourceId).toBe('1770000000000_report.xlsx');
    expect(result.name).toBe('report.xlsx');
  });

  it('accepts legacy url field as tempUrl fallback', () => {
    const result = parseOssFileUploadPayload({
      success: true,
      data: {
        ossKey: 'temp/uploads/demo.pdf',
        url: 'https://oss.example.com/demo.pdf',
      },
    });
    expect(result.tempUrl).toBe('https://oss.example.com/demo.pdf');
  });

  it('throws when envelope is incomplete', () => {
    expect(() => parseOssFileUploadPayload({ success: true, data: {} })).toThrow(
      /missing ossKey or tempUrl/,
    );
  });
});
