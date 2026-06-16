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

  it('keeps the prompt aligned with the narrower shell policy', () => {
    expect(WORKFLOW_SYSTEM_PROMPT).toContain('Regular non-workflow sai-cli commands are allowed.');
  });
});
