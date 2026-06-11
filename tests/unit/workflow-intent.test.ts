import { describe, expect, it } from 'vitest';
import {
  isWorkflowCreationIntent,
  isWorkflowStartIntent,
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
