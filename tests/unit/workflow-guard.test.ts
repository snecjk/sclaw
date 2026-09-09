import { describe, expect, it, vi } from 'vitest';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import {
  STO_WORKFLOW_CAPABILITY,
  type StoWorkflowPort,
} from '../../electron/agent-extensions/extensions/sto-workflow-tool/capability';
import {
  STO_WORKFLOW_SYSTEM_PROMPT,
  stoWorkflowToolDefinition,
} from '../../electron/agent-extensions/extensions/sto-workflow-tool/definition';
import { WORKFLOW_EXECUTION_STARTED_STATE_KEY } from '../../electron/agent-extensions/extensions/sto-workflow-tool/operations';

function dependencies() {
  const port: StoWorkflowPort = {
    isAvailable: vi.fn(async () => true),
    searchTemplates: vi.fn(),
    getStartupSchema: vi.fn(),
    createWorkflow: vi.fn(),
    startWorkflow: vi.fn(),
    getRun: vi.fn(),
  };
  const logger: SclawExtensionLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  return {
    capabilities: new SclawCapabilityRegistry().provide(STO_WORKFLOW_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
    logger,
  };
}

async function buildGuard(sessionKey = 'agent:main:workflow') {
  const result = await buildClaudeAgentExtensions({
    sessionKey,
    mode: 'interactive',
    userPrompt: '创建一个工作流',
    entries: [{ common: stoWorkflowToolDefinition }],
    ...dependencies(),
  });
  return result.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
}

async function callGuard(guard: HookCallback, toolName: string, input: Record<string, unknown>) {
  return guard({
    hook_event_name: 'PreToolUse',
    session_id: 'sdk-session-1',
    transcript_path: 'transcript.jsonl',
    cwd: 'D:/sai/sto-claw',
    tool_name: toolName,
    tool_input: input,
    tool_use_id: `tool-${toolName}`,
  }, `tool-${toolName}`, { signal: new AbortController().signal });
}

describe('sto-workflow-tool common guard', () => {
  it('allows regular sai-cli commands that are unrelated to workflows', async () => {
    expect(await callGuard(
      await buildGuard(),
      'Bash',
      { command: 'sai-cli finance bill query --billNo A001' },
    )).toEqual({});
  });

  it('blocks explicit workflow shell commands', async () => {
    const result = await callGuard(
      await buildGuard(),
      'Bash',
      { command: 'sai-cli workflow run --id wf_123' },
    );
    expect(result?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    });
  });

  it('allows DingTalk delivery when the message describes a workflow result', async () => {
    expect(await callGuard(
      await buildGuard(),
      'Bash',
      { command: 'dws chat message send --group cid123 --title "工作流执行结果" --text "STO workflow completed" --format json' },
    )).toEqual({});
  });

  it('blocks create_workflow after get_workflow_schema in the same turn', async () => {
    const guard = await buildGuard();
    expect(await callGuard(guard, 'mcp__sto-workflow-tool__get_workflow_schema', {})).toEqual({});
    const result = await callGuard(guard, 'mcp__sto-workflow-tool__create_workflow', {});
    expect(result?.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
  });

  it('blocks same-turn interactive status polling after a successful launch', () => {
    const deps = dependencies();
    const state = deps.stateManager.forExtension('agent:main:workflow', 'sto-workflow-tool');
    state.turn.set(WORKFLOW_EXECUTION_STARTED_STATE_KEY, 'run-1');
    const guard = stoWorkflowToolDefinition.policies?.[0]?.beforeTool;
    if (!guard) throw new Error('missing workflow guard');

    expect(guard({
      rawToolName: 'get_workflow_status',
      toolName: 'get_workflow_status',
      toolKind: 'other',
      toolCallId: 'tool-status',
      input: { runId: 'run-1' },
    }, {
      engine: 'claude', sessionKey: 'agent:main:workflow', mode: 'interactive', commandShell: 'bash',
      capabilities: deps.capabilities, state, logger: deps.logger,
    })).toMatchObject({ action: 'deny' });

    expect(guard({
      rawToolName: 'get_workflow_status',
      toolName: 'get_workflow_status',
      toolKind: 'other',
      toolCallId: 'tool-status-scheduled',
      input: { runId: 'run-1' },
    }, {
      engine: 'claude', sessionKey: 'agent:main:workflow', mode: 'scheduled', commandShell: 'bash',
      capabilities: deps.capabilities, state, logger: deps.logger,
    })).toMatchObject({ action: 'allow' });
  });

  it('keeps the prompt aligned with the narrower shell policy', () => {
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('【意图分流】');
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('【创建工作流】');
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('【执行与查询】');
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('对话卡片会独立刷新进度和结果');
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('【工具边界与失败处理】');
    expect(STO_WORKFLOW_SYSTEM_PROMPT).toContain('`dws chat message send`');
  });
});
