import { describe, expect, it } from 'vitest';
import {
  buildWorkflowStartUnavailablePrompt,
  isTemplateNameWorkflowTurn,
  isWorkflowCreationIntent,
  isWorkflowFormUserTurn,
  isWorkflowStartIntent,
  isImperativeWorkflowStartIntent,
  isReExecutionIntent,
  isWorkflowSessionLookupIntent,
  shouldInjectWorkflowSessionHint,
  extractWorkflowIdFromText,
} from '@/hooks/use-workflow-intent';
import { buildWorkflowCreationHint } from '@/lib/workflow-session-hint';

describe('isWorkflowCreationIntent', () => {
  it('matches NL workflow creation', () => {
    expect(isWorkflowCreationIntent('云端agent测试-产物测试 创建工作流')).toBe(true);
    expect(isWorkflowCreationIntent('帮我创建结算对账工作流')).toBe(true);
    expect(isWorkflowCreationIntent('新建一个客户异常监控 workflow')).toBe(true);
  });

  it('does not match file/folder creation', () => {
    expect(isWorkflowCreationIntent('帮我在桌面创建文件夹')).toBe(false);
    expect(isWorkflowCreationIntent('创建一个报告文档')).toBe(false);
  });

  it('does not match re-execution or start intents', () => {
    expect(isWorkflowCreationIntent('重新执行这个工作流')).toBe(false);
    expect(isWorkflowCreationIntent('运行这个工作流')).toBe(false);
  });

  it('does not overlap with start intent without create verb', () => {
    expect(isWorkflowStartIntent('执行工作流')).toBe(true);
    expect(isWorkflowCreationIntent('执行工作流')).toBe(false);
  });
});

describe('isTemplateNameWorkflowTurn', () => {
  it('matches direct template name without 创建工作流', () => {
    expect(isTemplateNameWorkflowTurn('客户异常监控', '客户异常监控')).toBe(true);
    expect(isTemplateNameWorkflowTurn('客户异常监控', '客户异常监控工作流')).toBe(true);
    expect(isWorkflowFormUserTurn('客户异常监控', '客户异常监控')).toBe(true);
    expect(isTemplateNameWorkflowTurn('随便生成一个和', '客户异常监控')).toBe(false);
  });
});

describe('re-run / start intents', () => {
  it('matches re-execution phrases', () => {
    expect(isReExecutionIntent('再跑一遍')).toBe(true);
    expect(isReExecutionIntent('再执行一下')).toBe(true);
    expect(isReExecutionIntent('再来一次执行')).toBe(false);
    expect(isWorkflowStartIntent('运行这个工作流')).toBe(true);
  });

  it('distinguishes imperative start from analytical workflow phrasing', () => {
    expect(isImperativeWorkflowStartIntent('执行工作流')).toBe(true);
    expect(isImperativeWorkflowStartIntent('运行这个工作流')).toBe(true);
    expect(isImperativeWorkflowStartIntent('分析一下工作流的执行情况')).toBe(false);
    expect(isWorkflowStartIntent('分析一下工作流的执行情况')).toBe(true);
  });

  it('matches workflowId lookup in session', () => {
    expect(isWorkflowSessionLookupIntent('帮我找一下会话中的 workflowId')).toBe(true);
    expect(isWorkflowSessionLookupIntent('工作流 ID 是多少')).toBe(true);
    expect(shouldInjectWorkflowSessionHint('再执行一下')).toBe(true);
    expect(shouldInjectWorkflowSessionHint('帮我找一下会话中的 workflowId')).toBe(true);
  });

  it('extracts workflowId from re-execution text', () => {
    expect(extractWorkflowIdFromText('重新执行 wf_68162433')).toBe('wf_68162433');
  });

  it('builds unavailable prompt when no workflow memory', () => {
    expect(buildWorkflowStartUnavailablePrompt()).toContain('没有可运行的工作流记录');
  });
});

describe('buildWorkflowCreationHint', () => {
  it('includes tool chain and user text', () => {
    const hint = buildWorkflowCreationHint('创建工作流测试');
    expect(hint).toContain('search_workflow_templates');
    expect(hint).toContain('禁止 exec');
    expect(hint).toContain('用户原话：创建工作流测试');
  });
});

describe('stripWorkflowSessionHintForDisplay', () => {
  it('strips creation hint and keeps user text', async () => {
    const { appendWorkflowSessionHint, stripWorkflowSessionHintForDisplay } = await import(
      '@/lib/workflow-session-hint'
    );
    const injected = appendWorkflowSessionHint(
      '云端agent测试-产物测试 创建工作流',
      buildWorkflowCreationHint('云端agent测试-产物测试 创建工作流'),
    );
    expect(stripWorkflowSessionHintForDisplay(injected)).toBe('云端agent测试-产物测试 创建工作流');
  });
});
