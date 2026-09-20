import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';
import { RETIRED_SKILLS_SYSTEM_PROMPT } from '../../shared/retired-skills';
import { SCHEDULED_TASK_CORE_PROMPT } from '../../shared/scheduled-task-instruction';
import { STO_SCHEDULED_TASK_SYSTEM_PROMPT } from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/definition';
import { STO_WORKFLOW_SYSTEM_PROMPT } from '../../electron/agent-extensions/extensions/sto-workflow-tool/definition';
import { USER_SKILL_SYSTEM_PROMPT } from '../../electron/agent-extensions/extensions/sto-skill-runtime/definition';
import { BRIDGE_SYSTEM_PROMPT } from '../../electron/agent-extensions/extensions/sto-browser-tool/prompts';
import { buildClaudeRuntimeOptions } from '../../electron/engines/claude-runtime-extensions';

let pendingDingTalkContext: Record<string, unknown> | null = null;

describe('buildClaudeRuntimeOptions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    pendingDingTalkContext = null;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/pending/has')) {
        return { ok: true, json: async () => ({ pending: pendingDingTalkContext !== null }) };
      }
      if (url.includes('/pending/consume')) {
        const payload = pendingDingTalkContext;
        pendingDingTalkContext = null;
        return { ok: true, json: async () => payload };
      }
      if (url.includes('/send/reserve')) {
        return { ok: true, json: async () => ({ allowed: true }) };
      }
      if (url.includes('/send/complete')) {
        return { ok: true, json: async () => ({ success: true }) };
      }
      if (url.includes('/api/auth/status')) {
        return { ok: true, json: async () => ({ isAuthenticated: true }) };
      }
      return { ok: true, json: async () => ({}) };
    }));
  });

  it('injects retired skills deprecation into Claude system prompt', async () => {
    const runtime = await buildClaudeRuntimeOptions('sess-retired');

    expect(runtime.systemPromptAppend).toContain(RETIRED_SKILLS_SYSTEM_PROMPT);
    expect(runtime.systemPromptAppend).toContain('sto-distinctive-design');
    expect(runtime.systemPromptAppend).toContain('cli-report-generator');
    expect(runtime.systemPromptAppend).toContain('sto-distinctive-design-guard');
  });

  it('uses execution prompt for production claude-task dated session keys', async () => {
    const runtime = await buildClaudeRuntimeOptions('claude-task:task-1:2026-06-25');

    expect(runtime.systemPromptAppend).toContain(SCHEDULED_TASK_CORE_PROMPT);
    expect(runtime.systemPromptAppend).not.toContain(STO_SCHEDULED_TASK_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-scheduled-task-tool']).toBeUndefined();
  });

  it('keeps scheduled-task management prompt and MCP out of unrelated chat turns', async () => {
    const runtime = await buildClaudeRuntimeOptions('agent:main:ordinary', '帮我分析这个项目');

    expect(runtime.systemPromptAppend).not.toContain(STO_SCHEDULED_TASK_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-scheduled-task-tool']).toBeUndefined();
    expect(runtime.mcpServers?.['sto-browser-tool']).toBeUndefined();
    expect(runtime.systemPromptAppend).not.toContain(BRIDGE_SYSTEM_PROMPT);
  });

  it('activates scheduled-task management prompt and MCP for a matching chat turn', async () => {
    const runtime = await buildClaudeRuntimeOptions('agent:main:scheduled-management', '列出我的定时任务');

    expect(runtime.systemPromptAppend).toContain(STO_SCHEDULED_TASK_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-scheduled-task-tool']).toBeDefined();
  });

  it('activates the migrated workflow extension only for workflow intent', async () => {
    const runtime = await buildClaudeRuntimeOptions(
      'agent:main:workflow-management',
      '帮我创建一个工作流',
    );

    expect(runtime.systemPromptAppend).toContain(STO_WORKFLOW_SYSTEM_PROMPT);
    expect(runtime.mcpServers?.['sto-workflow-tool']).toBeDefined();
  });

  it('activates user-skill management on matching turns', async () => {
    const unrelated = await buildClaudeRuntimeOptions(
      'agent:main:user-skill-unrelated',
      '分析一下这个项目',
    );
    const matched = await buildClaudeRuntimeOptions(
      'agent:main:user-skill-create',
      '把这个方法保存成用户技能',
    );

    expect(unrelated.mcpServers?.['sto-skill-runtime']).toBeDefined();
    expect(unrelated.systemPromptAppend).not.toContain(USER_SKILL_SYSTEM_PROMPT);
    expect(matched.mcpServers?.['sto-skill-runtime']).toBeDefined();
    expect(matched.systemPromptAppend).toContain(USER_SKILL_SYSTEM_PROMPT);
  });

  it('activates the migrated browser bridge for browser-operation intent', async () => {
    const runtime = await buildClaudeRuntimeOptions(
      'agent:main:browser-operation',
      '点击当前浏览器页面里的客户管理菜单',
    );
    expect(runtime.mcpServers?.['sto-browser-tool']).toBeDefined();
    expect(runtime.systemPromptAppend).toContain(BRIDGE_SYSTEM_PROMPT);
  });

  it('does not register browser automation for app-dev coding sessions', async () => {
    const runtime = await buildClaudeRuntimeOptions('agent:proj-x:appdev:workspace-1');

    expect(runtime.mcpServers?.['sto-browser-tool']).toBeUndefined();
    expect(runtime.mcpServers?.['sto-workflow-tool']).toBeUndefined();
    expect(runtime.systemPromptAppend ?? '').not.toContain('bridge_click');
  });

  it('registers embed bridge prompt for app plaza embed sessions', async () => {
    const runtime = await buildClaudeRuntimeOptions('agent:main:session-embed-app-tb--x');

    expect(runtime.mcpServers?.['sto-browser-tool']).toBeDefined();
    expect(runtime.systemPromptAppend).toContain('同一任务不要混用两套工具');
  });

  it('uses the engine-neutral Chinese scheduled-task management policy', () => {
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('SClaw 本地定时任务工具使用规则');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('【意图分流】');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('【时间规则】');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('0 9 * * *;30 15 * * *');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('0 9 L * *');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('【执行目标与结构化字段】');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('create/list/get/update/delete/trigger_sto_scheduled_task');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).toContain('`dws chat message send` 是普通钉钉消息发送');
    expect(STO_SCHEDULED_TASK_SYSTEM_PROMPT).not.toContain('Claude 本地定时任务工具使用规则');
  });

  it('injects oral send guard only when DingTalk intent matches', async () => {
    const { DINGTALK_ORAL_SEND_GUARD } = await import('../../shared/dingtalk-prompts/dingtalk-oral-send-prompt');
    const unrelated = await buildClaudeRuntimeOptions('agent:main:chat-1', '帮我分析这个项目');
    const matched = await buildClaudeRuntimeOptions('agent:main:chat-2', '帮我发一条钉钉消息');

    expect(unrelated.systemPromptAppend).not.toContain(DINGTALK_ORAL_SEND_GUARD);
    expect(matched.systemPromptAppend).toContain(DINGTALK_ORAL_SEND_GUARD);
  });

  it('does not inject oral send guard on scheduled-task execution sessions', async () => {
    const { DINGTALK_ORAL_SEND_GUARD } = await import('../../shared/dingtalk-prompts/dingtalk-oral-send-prompt');
    const runtime = await buildClaudeRuntimeOptions('claude-task:task-1:2026-06-25');

    expect(runtime.systemPromptAppend).not.toContain(DINGTALK_ORAL_SEND_GUARD);
  });

  it('injects pending DingTalk mention context into Claude system prompt', async () => {
    pendingDingTalkContext = {
      sessionKey: 'sess-1',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '你好',
      writtenAt: Date.now(),
    };

    const runtime = await buildClaudeRuntimeOptions('sess-1');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent-extensions/dingtalk-send-guard/pending/consume'),
      expect.objectContaining({ body: JSON.stringify({ sessionKey: 'sess-1' }) }),
    );
    expect(runtime.systemPromptAppend).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(runtime.systemPromptAppend).toContain('u-001');
    expect(runtime.systemPromptAppend).toContain('张三');
  });

});
