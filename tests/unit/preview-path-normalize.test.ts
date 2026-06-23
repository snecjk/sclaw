import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWindowsDrivePath, normalizeLocalFilePath, toMarkdownPreviewPath } from '@/lib/preview-url';

describe('normalizeLocalFilePath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('decodes percent-encoded Windows backslashes and normalizes separators', () => {
    const encoded = 'C:%5Cruntime%5Coutputs%5Creport.html';
    expect(normalizeLocalFilePath(encoded)).toBe('C:/runtime/outputs/report.html');
  });

  it('leaves Unix absolute paths unchanged', () => {
    expect(normalizeLocalFilePath('/Users/me/report.html')).toBe('/Users/me/report.html');
  });

  it('expands /.stoclaw when HOME is set', () => {
    vi.stubEnv('HOME', '/Users/sto');
    expect(
      normalizeLocalFilePath('/.stoclaw/openclaw/workspace/.claw-output/report.html'),
    ).toBe('/Users/sto/.stoclaw/openclaw/workspace/.claw-output/report.html');
  });

  it('leaves http URLs unchanged', () => {
    const url = 'https://cdn.example.com/report.html';
    expect(normalizeLocalFilePath(url)).toBe(url);
  });

  it('detects Windows drive paths', () => {
    expect(isWindowsDrivePath('C:\\runtime\\out.html')).toBe(true);
    expect(isWindowsDrivePath('C:/runtime/out.html')).toBe(true);
    expect(isWindowsDrivePath('/runtime/out.html')).toBe(false);
  });
});

describe('toMarkdownPreviewPath', () => {
  it('converts Windows backslashes to forward slashes (avoids markdown \\. escape)', () => {
    const windows = 'C:\\Users\\admin\\.stoclaw\\openclaw\\workspace\\output\\report.html';
    expect(toMarkdownPreviewPath(windows)).toBe(
      'C:/Users/admin/.stoclaw/openclaw/workspace/output/report.html',
    );
  });

  it('leaves macOS absolute paths unchanged', () => {
    const unix = '/Users/me/.stoclaw/openclaw/workspace/output/report.html';
    expect(toMarkdownPreviewPath(unix)).toBe(unix);
  });

  it('leaves relative unix-style paths unchanged', () => {
    expect(toMarkdownPreviewPath('./.claw-output/report.html')).toBe('./.claw-output/report.html');
    expect(toMarkdownPreviewPath('output/report.html')).toBe('output/report.html');
  });

  it('leaves http URLs unchanged', () => {
    const url = 'https://example.com/report.html';
    expect(toMarkdownPreviewPath(url)).toBe(url);
  });
});
