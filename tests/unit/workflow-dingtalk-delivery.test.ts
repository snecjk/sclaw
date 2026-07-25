import { describe, expect, it } from 'vitest';
import {
  buildWorkflowDingTalkDwsArgs,
  dedupeDingTalkRecipients,
  formatWorkflowDingTalkBody,
} from '../../shared/dingtalk-send/workflow-dingtalk-delivery';
import { DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER } from '../../shared/dingtalk-prompts/dingtalk-disclaimer';

describe('formatWorkflowDingTalkBody', () => {
  it('formats completed run with summary and http artifact', () => {
    const body = formatWorkflowDingTalkBody({
      workflowTitle: '客户异常监控',
      state: {
        status: 'completed',
        result: {
          summary: '发现 14 个异常客户',
          artifacts: [
            {
              id: 'a1',
              name: '报告.html',
              type: 'text/html',
              url: 'https://oss.example.com/r.html',
            },
          ],
        },
      },
    });
    expect(body).toContain('【客户异常监控】');
    expect(body).toContain('发现 14 个异常客户');
    expect(body).toContain('报告.html：https://oss.example.com/r.html');
    expect(body).toContain(DINGTALK_AGENT_SEND_DISCLAIMER_FOOTER);
  });

  it('formats failed run with error', () => {
    const body = formatWorkflowDingTalkBody({
      workflowTitle: '日报',
      state: {
        status: 'failed',
        error: '节点执行超时',
      },
    });
    expect(body).toContain('【日报】执行失败');
    expect(body).toContain('节点执行超时');
  });

  it('formats timeout run', () => {
    const body = formatWorkflowDingTalkBody({
      state: { status: 'timeout' },
    });
    expect(body).toContain('工作流执行失败');
    expect(body).toContain('工作流执行超时');
  });
});

describe('buildWorkflowDingTalkDwsArgs', () => {
  it('builds user send args', () => {
    expect(
      buildWorkflowDingTalkDwsArgs(
        { type: 'user', displayName: '张三', userId: 'u1' },
        { title: '消息', body: 'hello' },
      ),
    ).toEqual([
      'chat',
      'message',
      'send',
      '--user',
      'u1',
      '--title',
      '消息',
      '--text',
      'hello',
      '--format',
      'json',
    ]);
  });
});

describe('dedupeDingTalkRecipients', () => {
  it('dedupes by userId', () => {
    const out = dedupeDingTalkRecipients([
      { type: 'user', displayName: 'A', userId: 'u1' },
      { type: 'user', displayName: 'B', userId: 'u1' },
    ]);
    expect(out).toHaveLength(1);
  });
});
