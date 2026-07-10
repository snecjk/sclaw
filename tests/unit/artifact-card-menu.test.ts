import { describe, expect, it } from 'vitest';
import { buildArtifactCardMenuItems } from '../../src/lib/artifact-card-menu';

const t = (key: string) => key;

describe('buildArtifactCardMenuItems', () => {
  it('returns local file actions for filesystem paths', () => {
    const items = buildArtifactCardMenuItems({
      filePath: '/Users/sto/report.xlsx',
      fileName: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 1024,
      preview: null,
    }, t);

    expect(items.map((item) => item.id)).toEqual(['showInFolder', 'copyFile']);
    expect(items[0]?.label).toBe('artifact.openFileLocation');
    expect(items[1]?.label).toBe('artifact.copyFile');
  });

  it('returns remote link actions for https urls', () => {
    const items = buildArtifactCardMenuItems({
      filePath: 'https://oss.example.com/report.xlsx',
      downloadUrl: 'https://oss.example.com/report.xlsx?download=1',
      fileName: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 0,
      preview: null,
    }, t);

    expect(items.map((item) => item.id)).toEqual(['download', 'copyLink']);
    expect(items[0]?.label).toBe('preview.download');
    expect(items[1]?.label).toBe('artifact.copyLink');
  });
});
