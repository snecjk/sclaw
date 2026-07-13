import { describe, expect, it } from 'vitest';
import {
  buildWorkflowExecutionInstruction,
  detectMetaScheduledTaskIntent,
  evaluateScheduledTaskCreationBlock,
  isScheduledTaskExecutionSessionKey,
  normalizeScheduledTaskInstruction,
  SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT,
} from '../../shared/scheduled-task-instruction';
import { SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT as VENDORED_SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT } from '../../sto-plugin/openclaw/sto-scheduled-task-tool/shared/scheduled-task-instruction';

describe('scheduled-task-instruction', () => {
  it('detects cron and claude task execution session keys', () => {
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1:2026-06-25')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1:run:abc')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('claude-task-run:task-1:run-1')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:main')).toBe(false);
  });

  it('blocks scheduled task creation tools in execution context', () => {
    expect(evaluateScheduledTaskCreationBlock({
      sessionKey: 'agent:main:cron:job-1',
      toolName: 'cron',
    }).blocked).toBe(true);
    expect(evaluateScheduledTaskCreationBlock({
      sessionKey: 'claude-task-run:task-1:run-1',
      toolName: 'create_claude_scheduled_task',
    }).blocked).toBe(true);
    expect(evaluateScheduledTaskCreationBlock({
      sessionKey: 'agent:main:main',
      toolName: 'cron',
    }).blocked).toBe(false);
  });

  it('normalizes meta scheduled-task wording into execution intent', () => {
    const result = normalizeScheduledTaskInstruction({
      instruction: '帮我每天 10 点创建一个执行客户成本分析工作流的任务',
    });

    expect(result.changed).toBe(true);
    expect(result.instruction).toContain('执行');
    expect(result.instruction).toContain('客户成本分析工作流');
    expect(result.instruction).not.toMatch(/创建/);
    expect(result.instruction).not.toMatch(/10\s*点/);
  });

  it('uses workflow template when workflow id is provided', () => {
    const workflowId = 'wf_123';
    expect(buildWorkflowExecutionInstruction(workflowId, '客户成本分析')).toBe(
      '帮我执行 id 为：wf_123 的工作流 【客户成本分析】',
    );

    const result = normalizeScheduledTaskInstruction({
      instruction: '每天 9 点跑一下',
      workflowId,
      workflowName: '客户成本分析',
    });

    expect(result.instruction).toBe('帮我执行 id 为：wf_123 的工作流 【客户成本分析】');
    expect(result.changed).toBe(true);
  });

  it('detects meta task intent', () => {
    expect(detectMetaScheduledTaskIntent('帮我每天 10 点创建一个定时任务')).toBe(true);
    expect(detectMetaScheduledTaskIntent('执行客户成本分析工作流')).toBe(false);
  });

  it('execution system prompt overrides chat forward rules for dingtalk delivery', () => {
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('不是对话 @ 代发');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('执行结果');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('dws chat message send');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('优先于 message 内');
  });

  it('documents the local-artifact-to-dingtalk-drive flow in the P0 instruction', () => {
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('【P0 本地产物上钉盘】');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('dws drive upload');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('不需要 `--space-id`');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('docUrl');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('禁止把 `file://` 路径写进钉钉正文');
  });

  it('keeps the vendored openclaw copy byte-equal to the shared source', () => {
    expect(VENDORED_SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toBe(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT);
  });
});
