import { describe, expect, it } from 'vitest';
import {
  coerceHrefForMarkdownTransform,
  extractLocalPathFromHref,
  shouldPreviewInSidePanel,
} from '@/lib/preview-href';
import { classifyPreviewHref } from '../../shared/preview-href';

const WIN_PATH = String.raw`C:\Users\admin\.openclaw\workspace\.claw-output\report.html`;
const WIN_NORMALIZED = 'C:/Users/admin/.openclaw/workspace/.claw-output/report.html';

describe('extractLocalPathFromHref', () => {
  it('handles preview:// and file:// schemes', () => {
    expect(extractLocalPathFromHref('preview:///Users/sto/a.html')).toBe('/Users/sto/a.html');
    expect(extractLocalPathFromHref('file:///Users/sto/a.html')).toBe('/Users/sto/a.html');
  });

  it('handles file:/// with spaces in filename', () => {
    const uri = 'file:///Users/sto/.openclaw/workspace/.claw-output/申通快递分析 -20260625.html';
    expect(extractLocalPathFromHref(uri)).toBe(
      '/Users/sto/.openclaw/workspace/.claw-output/申通快递分析 -20260625.html',
    );
  });

  it('handles file:\\ and bare windows paths', () => {
    expect(extractLocalPathFromHref(`file:\\${WIN_PATH}`)).toBe(WIN_NORMALIZED);
    expect(extractLocalPathFromHref(WIN_PATH)).toBe(WIN_NORMALIZED);
  });
});

describe('coerceHrefForMarkdownTransform', () => {
  it('leaves http(s) unchanged regardless of link label', () => {
    const url = 'https://cdn.example.com/report.html';
    expect(coerceHrefForMarkdownTransform(url)).toBe(url);
    expect(classifyPreviewHref(url).type).toBe('http-external');
  });

  it('classifies company *.sto* domains as in-app preview', () => {
    const url = 'https://front.sto.cn/group/memory-center-web/workflows-workbench/wf_1';
    expect(coerceHrefForMarkdownTransform(url)).toBe(url);
    expect(classifyPreviewHref(url).type).toBe('http-preview');
  });

  it('coerces local hrefs to preview://', () => {
    const href = 'file:///Users/sto/.openclaw/workspace/.claw-output/申通快递分析 -20260625.html';
    expect(coerceHrefForMarkdownTransform(href)).toBe(
      'preview:///Users/sto/.openclaw/workspace/.claw-output/申通快递分析 -20260625.html',
    );
  });

  it('coerces windows drive paths to preview://', () => {
    expect(coerceHrefForMarkdownTransform(WIN_PATH)).toBe(`preview://${WIN_NORMALIZED}`);
  });

  it('leaves unknown schemes as passthrough for external open', () => {
    expect(coerceHrefForMarkdownTransform('foo:///tmp/a.html')).toBe('foo:///tmp/a.html');
    expect(classifyPreviewHref('foo:///tmp/a.html').type).toBe('external');
  });

  it('blocks dangerous schemes', () => {
    expect(coerceHrefForMarkdownTransform('javascript:alert(1)')).toBeNull();
  });

  it('classifies dingtalk and ftp as external (not preview://)', () => {
    expect(classifyPreviewHref('dingtalk://dingtalkclient/page/link?url=foo').type).toBe('external');
    expect(classifyPreviewHref('ftp://files.example.com/report.html').type).toBe('external');
    expect(coerceHrefForMarkdownTransform('ftp://files.example.com/report.html')).toBe(
      'ftp://files.example.com/report.html',
    );
  });
});

describe('shouldPreviewInSidePanel', () => {
  it('previews local paths, localhost, 127.0.0.1, and *.sto* http', () => {
    expect(shouldPreviewInSidePanel('/Users/sto/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('preview:///Users/sto/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('http://localhost:8080/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('http://127.0.0.1/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('https://sto.cn/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('https://baseinfo-aimemory-test.sto.cn/oss/report.html')).toBe(true);
    expect(shouldPreviewInSidePanel('https://sai-agent.oss-cn-shanghai.aliyuncs.com/report.html')).toBe(true);
  });

  it('opens other http links in the system browser', () => {
    expect(shouldPreviewInSidePanel('https://cdn.example.com/report.html')).toBe(false);
    expect(shouldPreviewInSidePanel('https://www.baidu.com')).toBe(false);
  });
});
