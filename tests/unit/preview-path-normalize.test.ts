import { describe, expect, it } from 'vitest';
import { isWindowsDrivePath, normalizeLocalFilePath } from '@/lib/preview-url';

describe('normalizeLocalFilePath', () => {
  it('decodes percent-encoded Windows backslashes', () => {
    const encoded = 'C:%5Cruntime%5Coutputs%5Creport.html';
    expect(normalizeLocalFilePath(encoded)).toBe('C:\\runtime\\outputs\\report.html');
  });

  it('leaves Unix absolute paths unchanged', () => {
    expect(normalizeLocalFilePath('/Users/me/report.html')).toBe('/Users/me/report.html');
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
