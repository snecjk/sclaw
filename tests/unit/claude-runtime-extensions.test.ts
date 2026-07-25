import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';
import { RETIRED_SKILLS_SYSTEM_PROMPT } from '../../shared/retired-skills';
import { SCHEDULED_TASK_CORE_PROMPT } from '../../shared/scheduled-task-instruction';
import { CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT } from '../../sto-plugin/claude/claude-scheduled-task-tool/tools';
import { buildClaudeRuntimeOptions } from '../../electron/engines/claude-runtime-extensions';
import { resetDingTalkSendRateLimitForTests } from '../../sto-plugin/claude/sto-dingtalk-send-guard/sdk/dingtalk-send-guard';

const { readDingTalkMentionPending, clearDingTalkMentionPending } = vi.hoisted(() => ({
  readDingTalkMentionPending: vi.fn(),
  clearDingTalkMentionPending: vi.fn(),
}));

vi.mock('../../electron/utils/dingtalk-mention-pending', () => ({
  readDingTalkMentionPending,
  clearDingTalkMentionPending,
}));

describe('buildClaudeRuntimeOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDingTalkSendRateLimitForTests();
    readDingTalkMentionPending.mockReset();
    clearDingTalkMentionPending.mockReset();
  });

  it('injects retired skills deprecation into Claude system prompt', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const runtime = await buildClaudeRuntimeOptions('sess-retired');

    expect(runtime.systemPromptAppend).toContain(RETIRED_SKILLS_SYSTEM_PROMPT);
    expect(runtime.systemPromptAppend).toContain('sto-distinctive-design');
    expect(runtime.systemPromptAppend).toContain('cli-report-generator');
    expect(runtime.systemPromptAppend).toContain('sto-distinctive-design-guard');
  });

  it('uses execution prompt for production claude-task dated session keys', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const runtime = await buildClaudeRuntimeOptions('claude-task:task-1:2026-06-25');

    expect(runtime.systemPromptAppend).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(runtime.systemPromptAppend).not.toContain(CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['claude-scheduled-task-tool']).toBeUndefined();
  });

  it('keeps management prompt and MCP for ordinary chat sessions', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const runtime = await buildClaudeRuntimeOptions('agent:main:main');

    expect(runtime.systemPromptAppend).toContain(CLAUDE_SCHEDULED_TASK_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['claude-scheduled-task-tool']).toBeDefined();
  });

  it('injects oral send guard for ordinary chat without pending mentions', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const { DINGTALK_ORAL_SEND_GUARD } = await import('../../shared/dingtalk-prompts/dingtalk-oral-send-prompt');
    const runtime = await buildClaudeRuntimeOptions('agent:main:chat-1');

    expect(runtime.systemPromptAppend).toContain(DINGTALK_ORAL_SEND_GUARD);
  });

  it('does not inject oral send guard on scheduled-task execution sessions', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const { DINGTALK_ORAL_SEND_GUARD } = await import('../../shared/dingtalk-prompts/dingtalk-oral-send-prompt');
    const runtime = await buildClaudeRuntimeOptions('claude-task:task-1:2026-06-25');

    expect(runtime.systemPromptAppend).not.toContain(DINGTALK_ORAL_SEND_GUARD);
  });

  it('injects pending DingTalk mention context into Claude system prompt', async () => {
    readDingTalkMentionPending.mockResolvedValue({
      sessionKey: 'sess-1',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '你好',
      writtenAt: Date.now(),
    });
    clearDingTalkMentionPending.mockResolvedValue(undefined);

    const runtime = await buildClaudeRuntimeOptions('sess-1');

    expect(readDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(clearDingTalkMentionPending).toHaveBeenCalledWith('sess-1');
    expect(runtime.systemPromptAppend).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(runtime.systemPromptAppend).toContain('u-001');
    expect(runtime.systemPromptAppend).toContain('张三');
  });

  it('blocks Bash batch sends and rate-limits only after a success', async () => {
    readDingTalkMentionPending.mockResolvedValue(null);

    const runtime = await buildClaudeRuntimeOptions('sess-guard');
    const preTool = runtime.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const postTool = runtime.hooks?.PostToolUse?.[0]?.hooks[0] as HookCallback;

    expect(preTool).toBeTypeOf('function');
    expect(postTool).toBeTypeOf('function');

    const batchResult = await preTool({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'for i in 1 2; do dws chat message send --user u1 --title "消息" --text hello --format json; done',
      },
      tool_use_id: 'tool-batch',
    }, 'tool-batch', { signal: new AbortController().signal });

    expect(batchResult?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });

    const firstAllowed = await preTool({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
      },
      tool_use_id: 'tool-1',
    }, 'tool-1', { signal: new AbortController().signal });

    expect(firstAllowed?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      updatedInput: {
        command: expect.stringContaining('dws chat message send --user u1'),
      },
    });
    expect(firstAllowed?.hookSpecificOutput?.updatedInput?.command).toContain('--text');

    await postTool({
      hook_event_name: 'PostToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
      },
      tool_response: {
        stdout: '{"ok":true,"openTaskId":"t1"}',
        stderr: '',
        interrupted: false,
      },
      tool_use_id: 'tool-1',
    }, 'tool-1', { signal: new AbortController().signal });

    const secondBlocked = await preTool({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'dws chat message send --user u1 --title "消息" --text hello --format json',
      },
      tool_use_id: 'tool-2',
    }, 'tool-2', { signal: new AbortController().signal });

    expect(secondBlocked?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });
});
