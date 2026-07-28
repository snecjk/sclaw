import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskDingTalkPromptAppend,
  buildScheduledTaskExecutionSystemPrompt,
  buildWorkflowExecutionInstruction,
  detectMetaScheduledTaskIntent,
  evaluateScheduledTaskCreationBlock,
  isScheduledTaskExecutionSessionKey,
  normalizeScheduledTaskInstruction,
  SCHEDULED_TASK_CORE_PROMPT,
  SCHEDULED_TASK_DINGTALK_RULES,
  SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT,
  DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
} from '../../shared/scheduled-task-instruction';
import { SCHEDULED_TASK_CORE_PROMPT as VENDORED_CORE } from '../../sto-plugin/openclaw/sto-scheduled-task-tool/shared/scheduled-task-core';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';

describe('scheduled-task-instruction', () => {
  it('detects cron and claude task execution session keys', () => {
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1:2026-06-25')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:cron:job-1:run:abc')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('claude-task-run:task-1:run-1')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('claude-task:task-1:2026-06-25')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('claude-task:task-1')).toBe(true);
    expect(isScheduledTaskExecutionSessionKey('agent:main:main')).toBe(false);
    expect(isScheduledTaskExecutionSessionKey('agent:main:chat:abc')).toBe(false);
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
      sessionKey: 'claude-task:task-1:2026-06-25',
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

  it('injects only CORE when prompt has no dingtalk send signal', () => {
    const prompt = buildScheduledTaskExecutionSystemPrompt({ prompt: '查询上海天气' });
    expect(prompt).toBe(SCHEDULED_TASK_CORE_PROMPT);
    expect(prompt).not.toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(prompt).not.toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
    // CORE 不得暗示「系统代发」，避免非工作流任务被当成工作流程序发送
    expect(prompt).not.toContain('钉钉由系统在终态自动发送');
    expect(prompt).not.toContain('Agent 无需发送');
  });

  it('injects CORE + format when prompt has dws send but no recipients block', () => {
    const prompt = buildScheduledTaskExecutionSystemPrompt({
      prompt: '查天气后 dws chat message send --user 1 --text hi',
    });
    expect(prompt).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(prompt).toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
    expect(prompt).not.toContain(SCHEDULED_TASK_DINGTALK_RULES);
  });

  it('injects CORE + dingtalk rules + format when prompt has recipients marker', () => {
    const prompt = buildScheduledTaskExecutionSystemPrompt({
      prompt: `${DINGTALK_RECIPIENTS_MARKER}\n查天气`,
    });
    expect(prompt).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(prompt).toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(prompt).toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
    expect(prompt).toContain('不要假设「系统会在终态自动发送」');
    expect(prompt).not.toContain('定时任务钉钉（工作流 · 程序发送）');
  });

  it('injects workflow delegate instead of module C when prompt involves workflow + recipients', () => {
    const prompt = buildScheduledTaskExecutionSystemPrompt({
      prompt: `${DINGTALK_RECIPIENTS_MARKER}\n帮我执行 id 为：wf_123 的工作流 【日报】`,
    });
    expect(prompt).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(prompt).toContain('程序发送');
    expect(prompt).not.toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(prompt).not.toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
  });

  it('buildScheduledTaskDingTalkPromptAppend uses workflow delegate for workflow + recipients block', () => {
    const withBlock = buildScheduledTaskDingTalkPromptAppend(
      `${DINGTALK_RECIPIENTS_MARKER}\nexecute_workflow wf_1`,
    );
    expect(withBlock).toContain('程序发送');
    expect(withBlock).not.toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(withBlock).not.toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
  });

  it('buildScheduledTaskDingTalkPromptAppend omits CORE', () => {
    expect(buildScheduledTaskDingTalkPromptAppend('查询天气')).toBeNull();
    expect(buildScheduledTaskDingTalkPromptAppend('dws chat message send --user 1')).toBe(
      DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
    );
    const withBlock = buildScheduledTaskDingTalkPromptAppend(
      `${DINGTALK_RECIPIENTS_MARKER}\n查天气`,
    );
    expect(withBlock).toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(withBlock).toContain(DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK);
    expect(withBlock).not.toContain(SCHEDULED_TASK_CORE_PROMPT);
  });

  it('deprecated full prompt is CORE + C + A composite', () => {
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain(SCHEDULED_TASK_DINGTALK_RULES);
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain(
      DINGTALK_SEND_FORMAT_RULES_FOR_SCHEDULED_TASK,
    );
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('dws chat message send');
    expect(SCHEDULED_TASK_EXECUTION_SYSTEM_PROMPT).toContain('dws drive upload');
  });

  it('keeps the vendored openclaw CORE byte-equal to the shared module B', () => {
    expect(VENDORED_CORE).toBe(SCHEDULED_TASK_CORE_PROMPT);
  });
});
