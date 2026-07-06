import { describe, expect, it } from 'vitest';
import {
  collectAllRunArtifacts,
  normalizeRunArtifacts,
  resolveWorkflowArtifactUrl,
} from '@/lib/workflow-run-status';

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
    expect(artifacts[0]?.name).toBe('今日笑话');
    expect(artifacts[0]?.type).toBe('html');
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
