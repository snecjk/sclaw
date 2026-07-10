import { describe, expect, it } from 'vitest';
import { buildWindowsHDrop } from '../../electron/utils/clipboard-rich-write';

describe('buildWindowsHDrop', () => {
  it('builds DROPFILES header with clipboard defaults and UTF-16 path list', () => {
    const buffer = buildWindowsHDrop(['C:\\Users\\admin\\report.html']);
    expect(buffer.length).toBeGreaterThan(20);

    expect(buffer.readUInt32LE(0)).toBe(20);
    expect(buffer.readInt32LE(4)).toBe(-1);
    expect(buffer.readInt32LE(8)).toBe(-1);
    expect(buffer.readInt32LE(12)).toBe(1);
    expect(buffer.readInt32LE(16)).toBe(1);

    const pathsSection = buffer.subarray(20);
    const decoded = pathsSection.toString('utf16le');
    expect(decoded).toContain('C:\\Users\\admin\\report.html');
    expect(decoded.endsWith('\0\0')).toBe(true);
  });

  it('normalizes forward slashes to Windows separators on win32', () => {
    if (process.platform !== 'win32') return;

    const buffer = buildWindowsHDrop(['C:/Users/admin/report.html']);
    const decoded = buffer.subarray(20).toString('utf16le');
    expect(decoded).toContain('C:\\Users\\admin\\report.html');
  });

  it('supports multiple files separated by null terminators', () => {
    const buffer = buildWindowsHDrop([
      'C:\\tmp\\a.html',
      'C:\\tmp\\b.pdf',
    ]);
    const decoded = buffer.subarray(20).toString('utf16le');
    expect(decoded).toContain('C:\\tmp\\a.html');
    expect(decoded).toContain('C:\\tmp\\b.pdf');
    expect(decoded.endsWith('\0\0')).toBe(true);
  });
});
