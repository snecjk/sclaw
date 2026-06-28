import { describe, expect, it } from 'vitest';
import {
  createFileUrlInTextRegex,
  isAttachableRawLocalPath,
  isTruncatedLocalPathPrefix,
  localPathFromFileUrlCapture,
} from '../../shared/preview-raw-path';
import { extractRawFilePaths } from '@/stores/chat/helpers';
import { extractPreviewableRefs } from '@/pages/Chat/message-utils';

describe('preview-raw-path', () => {
  it('allows spaces inside file:// URLs', () => {
    const text = 'file:///Users/sto/.claw-output/申通快递分析 -20260628.html';
    const regex = createFileUrlInTextRegex();
    const match = regex.exec(text);
    expect(match).not.toBeNull();
    const path = localPathFromFileUrlCapture(match![1]);
    expect(path).toBe('/Users/sto/.claw-output/申通快递分析 -20260628.html');
    expect(isAttachableRawLocalPath(path)).toBe(true);
  });

  it('rejects directory-only local paths without extension', () => {
    expect(isAttachableRawLocalPath('/Users/sto/.openclaw')).toBe(false);
    expect(isAttachableRawLocalPath('/Users/sto/.claw-output/申通快递分析')).toBe(false);
  });

  it('detects truncated path prefix siblings', () => {
    const short = '/Users/sto/.claw-output/申通快递分析';
    const full = '/Users/sto/.claw-output/申通快递分析 -20260628.html';
    expect(isTruncatedLocalPathPrefix(short, full)).toBe(true);
    expect(isTruncatedLocalPathPrefix(full, short)).toBe(false);
  });
});

describe('extractRawFilePaths', () => {
  it('extracts full html path with spaces, not truncated octet-stream sibling', () => {
    const text = '报告：[申通快递分析](file:///Users/sto/.claw-output/申通快递分析 -20260628.html)';
    const refs = extractRawFilePaths(text);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.filePath).toBe('/Users/sto/.claw-output/申通快递分析 -20260628.html');
    expect(refs[0]?.mimeType).toBe('text/html');
  });

  it('does not attach extensionless directory paths', () => {
    const text = 'see file:///Users/sto/.openclaw and file:///Users/sto/.claw-output/申通快递分析';
    const refs = extractRawFilePaths(text);
    expect(refs).toHaveLength(0);
  });
});

describe('extractPreviewableRefs', () => {
  it('extracts spaced filename from file:// URL in assistant text', () => {
    const text = 'file:///Users/sto/.claw-output/申通快递分析 -20260628.html';
    const refs = extractPreviewableRefs(text);
    expect(refs.some((r) => r.filePath.includes(' -20260628.html'))).toBe(true);
    expect(refs.some((r) => r.filePath.endsWith('申通快递分析'))).toBe(false);
  });
});
