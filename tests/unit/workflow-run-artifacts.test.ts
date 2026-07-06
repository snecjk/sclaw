import { describe, expect, it } from 'vitest';
import {
  collectAllRunArtifacts,
  normalizeRunArtifacts,
  resolveWorkflowArtifactUrl,
} from '@/lib/workflow-run-status';
import { artifactToPreviewFile } from '@/lib/preview-url';

describe('resolveWorkflowArtifactUrl', () => {
  it('prefers previewUrl over tempUrl and legacy url', () => {
    const previewUrl = 'https://baseinfo-chatbotapi-test.sto.cn/api/agentrun/artifact/preview?filePath=a.html&sign=1';
    const tempUrl = 'https://ali-sto-policy.oss-cn-shanghai.aliyuncs.com/outputs/a.html';

    expect(resolveWorkflowArtifactUrl({ previewUrl, tempUrl, url: tempUrl })).toBe(previewUrl);
  });

  it('falls back to tempUrl when previewUrl is absent', () => {
    const tempUrl = 'https://ali-sto-policy.oss-cn-shanghai.aliyuncs.com/outputs/a.html';
    expect(resolveWorkflowArtifactUrl({ tempUrl })).toBe(tempUrl);
  });
});

describe('normalizeRunArtifacts', () => {
  it('maps previewUrl into artifact.url', () => {
    const previewUrl = 'https://baseinfo-chatbotapi-test.sto.cn/api/agentrun/artifact/preview?filePath=a.html';
    const artifacts = normalizeRunArtifacts([
      {
        name: '今日笑话',
        kind: 'html',
        tempUrl: 'https://oss.example.com/a.html',
        previewUrl,
      },
    ]);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.url).toBe(previewUrl);
    expect(artifacts[0]?.previewUrl).toBe(previewUrl);
    expect(artifacts[0]?.tempUrl).toBe('https://oss.example.com/a.html');
    expect(artifacts[0]?.name).toBe('今日笑话');
    expect(artifacts[0]?.type).toBe('html');
  });

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

describe('collectAllRunArtifacts', () => {
  it('collects artifacts from result.artifacts with previewUrl', () => {
    const previewUrl = 'https://baseinfo-chatbotapi-test.sto.cn/api/agentrun/artifact/preview?filePath=joke.html';
    const artifacts = collectAllRunArtifacts({
      id: 'run_1',
      workflowId: 'wf_1',
      result: {
        title: '笑话 HTML 已生成',
        artifacts: [
          {
            name: '今日笑话',
            kind: 'html',
            tempUrl: 'https://oss.example.com/joke.html',
            previewUrl,
          },
        ],
      },
    });

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.url).toBe(previewUrl);
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
