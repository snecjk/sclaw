import { describe, expect, it } from 'vitest';
import {
  formatAssistantCopyShareClipboardText,
  formatAssistantCopyShareTextOnly,
  isWorkflowStartAssistantBoilerplate,
  resolveAssistantCopyShareContent,
} from '../../src/pages/Chat/message-utils';

describe('isWorkflowStartAssistantBoilerplate', () => {
  it('detects params-confirmed workflow launch text', () => {
    const input = '参数已确认，工作流已在后台启动执行（工作流 ID: wf_cb81b6b7），请稍候查看执行进度。';
    expect(isWorkflowStartAssistantBoilerplate(input)).toBe(true);
  });
});

describe('resolveAssistantCopyShareContent', () => {
  const boilerplate =
    '参数已确认，工作流已在后台启动执行（工作流 ID: wf_cb81b6b7），请稍候查看执行进度。';
  const summary =
    '客户异常监控报告已生成，监控151个客户中发现14个异常客户（占比9.27%），其中高风险4个、中风险1个、低风险9个。';
  const artifact = {
    id: 'art-1',
    name: '客户异常监控报告_20260707.html',
    type: 'text/html',
    url: 'https://oss.example.com/report.html',
  };

  it('uses workflow result summary instead of launch boilerplate', () => {
    const result = resolveAssistantCopyShareContent({
      text: boilerplate,
      assistantBubbleText: '',
      workflowCard: { runId: 'run_1', templateName: '客户异常监控' },
      workflowCardStates: {
        run_1: {
          runId: 'run_1',
          workflowId: 'wf_cb81b6b7',
          status: 'completed',
          progress: 100,
          steps: [],
          result: { summary, artifacts: [artifact] },
        },
      },
      previewFiles: [],
    });

    expect(result.text).toBe(summary);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.fileName).toContain('客户异常监控报告_20260707');
  });

  it('keeps non-boilerplate assistant bubble text when present', () => {
    const result = resolveAssistantCopyShareContent({
      text: `${boilerplate}\n${summary}`,
      assistantBubbleText: summary,
      workflowCard: { runId: 'run_1', templateName: '客户异常监控' },
      workflowCardStates: {
        run_1: {
          runId: 'run_1',
          workflowId: 'wf_cb81b6b7',
          status: 'completed',
          progress: 100,
          steps: [],
          result: { summary, artifacts: [artifact] },
        },
      },
      previewFiles: [],
    });

    expect(result.text).toBe(summary);
  });

  it('accepts a structured workflow summary without crashing', () => {
    const result = resolveAssistantCopyShareContent({
      text: boilerplate,
      assistantBubbleText: '',
      workflowCard: { runId: 'run_1', templateName: '客户异常监控' },
      workflowCardStates: {
        run_1: {
          runId: 'run_1',
          workflowId: 'wf_cb81b6b7',
          status: 'completed',
          progress: 100,
          steps: [],
          result: { summary: { text: summary } as unknown as string },
        },
      },
      previewFiles: [],
    });

    expect(result.text).toBe(boilerplate);
  });
});

describe('formatAssistantCopyShareTextOnly', () => {
  it('strips inline file:// markdown links without attachment footer', () => {
    const body = [
      '报告已生成。',
      '',
      '**报告文件**：[申通快递分析 -20260629.html](file:///Users/sto/.stoclaw/openclaw/workspace/.claw-output/shentong-analysis-20260629.html)',
    ].join('\n');

    const text = formatAssistantCopyShareTextOnly(body);

    expect(text).toContain('**报告文件**：申通快递分析 -20260629.html');
    expect(text).not.toContain('file:///');
    expect(text).not.toContain('附件：');
  });
});

describe('formatAssistantCopyShareClipboardText', () => {
  it('appends artifact markdown links after summary', () => {
    const text = formatAssistantCopyShareClipboardText(
      '客户异常监控报告已生成。',
      [{
        fileName: '客户异常监控报告_20260707',
        filePath: 'https://oss.example.com/report.html',
        mimeType: 'text/html',
        fileSize: 0,
        preview: null,
      }],
    );

    expect(text).toContain('客户异常监控报告已生成。');
    expect(text).toContain('[客户异常监控报告_20260707](https://oss.example.com/report.html)');
  });

  it('lists local artifact names without exposing filesystem paths', () => {
    const text = formatAssistantCopyShareClipboardText(
      '客户异常监控报告已生成。',
      [{
        fileName: '客户异常监控报告_20260707.html',
        filePath: '/Users/sto/.openclaw/workspace/.claw-output/report.html',
        mimeType: 'text/html',
        fileSize: 0,
        preview: null,
      }],
    );

    expect(text).toContain('客户异常监控报告已生成。');
    expect(text).toContain('附件：');
    expect(text).toContain('- 客户异常监控报告_20260707.html');
    expect(text).not.toContain('/Users/sto/.openclaw');
  });

  it('strips inline file:// markdown links from assistant body text', () => {
    const body = [
      '报告已生成并通过质量检查。',
      '',
      '**报告文件**：[申通快递分析 -20260629.html](file:///Users/sto/.stoclaw/openclaw/workspace/.claw-output/shentong-analysis-20260629.html)',
    ].join('\n');

    const text = formatAssistantCopyShareClipboardText(
      body,
      [{
        fileName: 'shentong-analysis-20260629.html',
        filePath: '/Users/sto/.stoclaw/openclaw/workspace/.claw-output/shentong-analysis-20260629.html',
        mimeType: 'text/html',
        fileSize: 0,
        preview: null,
      }],
    );

    expect(text).toContain('**报告文件**：申通快递分析 -20260629.html');
    expect(text).not.toContain('file:///');
    expect(text).not.toContain('/Users/sto/.stoclaw');
    expect(text).toContain('附件：');
    expect(text).toContain('- shentong-analysis-20260629.html');
  });
});
