import { describe, expect, it } from 'vitest';
import { normalizeRunArtifacts } from '@/lib/workflow-run-status';
import { artifactToPreviewFile } from '@/lib/preview-url';

describe('normalizeRunArtifacts', () => {
  it('maps previewUrl for preview and tempUrl for download', () => {
    const artifacts = normalizeRunArtifacts([
      {
        id: 'a1',
        name: 'report.xlsx',
        type: 'xlsx',
        previewUrl: 'https://preview.sto.cn/report.xlsx',
        tempUrl: 'https://oss.sto.cn/report.xlsx?sig=1',
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.url).toBe('https://preview.sto.cn/report.xlsx');
    expect(artifacts[0]?.previewUrl).toBe('https://preview.sto.cn/report.xlsx');
    expect(artifacts[0]?.tempUrl).toBe('https://oss.sto.cn/report.xlsx?sig=1');
  });

  it('falls back to legacy url when previewUrl/tempUrl are absent', () => {
    const artifacts = normalizeRunArtifacts([
      {
        id: 'a2',
        name: 'legacy.pdf',
        url: 'https://oss.sto.cn/legacy.pdf',
      },
    ]);

    expect(artifacts[0]?.url).toBe('https://oss.sto.cn/legacy.pdf');
    expect(artifacts[0]?.previewUrl).toBe('https://oss.sto.cn/legacy.pdf');
    expect(artifacts[0]?.tempUrl).toBe('https://oss.sto.cn/legacy.pdf');
  });
});

describe('artifactToPreviewFile', () => {
  it('uses previewUrl for filePath and tempUrl for downloadUrl', () => {
    const file = artifactToPreviewFile({
      name: 'report.xlsx',
      type: 'xlsx',
      url: 'https://preview.sto.cn/report.xlsx',
      previewUrl: 'https://preview.sto.cn/report.xlsx',
      tempUrl: 'https://oss.sto.cn/report.xlsx?sig=1',
    });

    expect(file.filePath).toBe('https://preview.sto.cn/report.xlsx');
    expect(file.downloadUrl).toBe('https://oss.sto.cn/report.xlsx?sig=1');
  });
});
