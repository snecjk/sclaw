import { describe, expect, it } from 'vitest';
import { createWorkflowGuard, WORKFLOW_SYSTEM_PROMPT } from '../../sto-plugin/claude/sto-workflow-tool/hooks';

describe('createWorkflowGuard', () => {
  it('allows regular sai-cli commands that are unrelated to workflows', async () => {
    const guard = createWorkflowGuard();

    const result = await guard({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'sai-cli finance bill query --billNo A001',
      },
      tool_use_id: 'tool-sai-cli-regular',
    }, 'tool-sai-cli-regular', { signal: new AbortController().signal });

    expect(result).toEqual({});
  });

  it('blocks explicit workflow shell commands', async () => {
    const guard = createWorkflowGuard();

    const result = await guard({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'sai-cli workflow run --id wf_123',
      },
      tool_use_id: 'tool-sai-cli-workflow',
    }, 'tool-sai-cli-workflow', { signal: new AbortController().signal });

    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('allows DingTalk delivery when the message describes a workflow result', async () => {
    const guard = createWorkflowGuard();

    const result = await guard({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session-1',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/sai/sto-claw',
      tool_name: 'Bash',
      tool_input: {
        command: 'dws chat message send --group cid123 --title "工作流执行结果" --text "STO workflow completed" --format json',
      },
      tool_use_id: 'tool-dingtalk-workflow-result',
    }, 'tool-dingtalk-workflow-result', { signal: new AbortController().signal });

    expect(result).toEqual({});
  });

  it('keeps the prompt aligned with the narrower shell policy', () => {
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('【意图分流】');
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('【创建工作流】');
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('【执行与查询】');
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('【工具边界与失败处理】');
    expect(WORKFLOW_SYSTEM_PROMPT).not.toContain('【定时任务钉钉通知】');
    expect(WORKFLOW_SYSTEM_PROMPT).not.toContain('StoClaw DingTalk Recipients JSON');
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('`dws chat message send`');
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('即使其 --title 或 --text 中含有 workflow、工作流等字样');
  });
});
