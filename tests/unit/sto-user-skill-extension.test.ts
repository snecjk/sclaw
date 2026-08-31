import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import { typeBoxObjectToZodRawShape } from '../../electron/agent-extensions/schema/typebox-to-zod';
import {
  STO_USER_SKILL_CAPABILITY,
  StoUserSkillPortError,
  type StoUserSkillPort,
} from '../../electron/agent-extensions/extensions/sto-user-skill-tool/capability';
import {
  USER_SKILL_SYSTEM_PROMPT,
  stoUserSkillToolDefinition,
} from '../../electron/agent-extensions/extensions/sto-user-skill-tool/definition';

const logger: SclawExtensionLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
};

function dependencies() {
  const port: StoUserSkillPort = {
    save: vi.fn(async () => ({
      ok: true,
      slug: 'demo-skill',
      scope: 'user',
      userCode: 'u-1',
      storePath: 'D:/skills/demo-skill',
      source: 'local',
    })),
    scheduleOrphanImport: vi.fn(async () => undefined),
  };
  return {
    port,
    capabilities: new SclawCapabilityRegistry().provide(STO_USER_SKILL_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
    logger,
  };
}

function preToolInput(toolCallId: string, toolName: string, toolInput: Record<string, unknown>) {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'sdk-session',
    transcript_path: 'transcript.jsonl',
    cwd: 'D:/workspace',
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: toolCallId,
  };
}

describe('sto-user-skill-tool common extension', () => {
  it('activates the Claude tool and prompt only for user-skill intent', async () => {
    const deps = dependencies();
    const entries = [{ common: stoUserSkillToolDefinition }];
    expect(stoUserSkillToolDefinition.tools).toHaveLength(1);
    expect(stoUserSkillToolDefinition.tools?.[0]?.parameters).toBeDefined();
    typeBoxObjectToZodRawShape(stoUserSkillToolDefinition.tools![0].parameters);
    const unrelated = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '分析一下这个项目',
      entries,
      ...deps,
    });
    expect(unrelated.options.mcpServers).toBeUndefined();
    expect(unrelated.options.systemPromptAppend).toBeUndefined();
    expect(unrelated.options.hooks?.PreToolUse).toBeDefined();

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '把这个流程整理成一个用户技能',
      entries,
      ...deps,
    });
    expect(matched.diagnostics).toEqual([]);
    expect(matched.options.mcpServers?.['sto-user-skill-tool']).toBeDefined();
    expect(matched.options.systemPromptAppend).toContain(USER_SKILL_SYSTEM_PROMPT);

    const followUp = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '名字改成 demo',
      entries,
      ...deps,
    });
    expect(followUp.options.mcpServers?.['sto-user-skill-tool']).toBeDefined();
  });

  it('registers a lazy PI tool and activates it from before_agent_start', async () => {
    const deps = dependencies();
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-user-skill',
      mode: 'interactive',
      entries: [{ common: stoUserSkillToolDefinition }],
      ...deps,
    });
    expect(result.registeredToolNames).toContain('save_user_skill');
    expect(result.initiallyActiveToolNames).not.toContain('save_user_skill');

    const handlers = new Map<string, (event: Record<string, unknown>) => unknown>();
    const activeTools: string[] = [];
    const extension = result.extensions.find(
      (item) => typeof item !== 'function' && item.name === 'sto-user-skill-tool',
    );
    if (!extension || typeof extension === 'function') throw new Error('missing extension');
    await extension.factory({
      registerTool() {},
      on(event, handler) { handlers.set(event, handler as never); },
      getActiveTools() { return activeTools; },
      setActiveTools(names) { activeTools.splice(0, activeTools.length, ...names); },
    } as never);

    const prompt = await handlers.get('before_agent_start')?.({
      prompt: '帮我创建一个技能',
      systemPrompt: 'base',
      systemPromptOptions: {},
    }) as { systemPrompt?: string } | undefined;
    expect(activeTools).toContain('save_user_skill');
    expect(prompt?.systemPrompt).toContain(USER_SKILL_SYSTEM_PROMPT);
  });

  it('returns the common success envelope and preserves Host API error codes', async () => {
    const deps = dependencies();
    const tool = stoUserSkillToolDefinition.tools?.[0];
    if (!tool) throw new Error('missing save_user_skill');
    const context = {
      engine: 'claude' as const,
      sessionKey: 'execute',
      mode: 'interactive' as const,
      commandShell: 'powershell' as const,
      capabilities: deps.capabilities,
      state: deps.stateManager.beginTurn('execute'),
      logger,
      toolCallId: 'save-1',
    };
    const success = await tool.execute({
      skillMd: '---\nname: demo\ndescription: demo\n---\n',
    }, context);
    expect(success).toMatchObject({
      success: true,
      type: 'user_skill_saved',
      domain: 'user-skill',
      data: { slug: 'demo-skill' },
    });

    vi.mocked(deps.port.save).mockRejectedValueOnce(
      new StoUserSkillPortError('PREINSTALL_PROTECTED', '不能覆盖预装技能'),
    );
    const failed = await tool.execute({
      skillMd: '---\nname: demo\ndescription: demo\n---\n',
    }, { ...context, toolCallId: 'save-2' });
    expect(failed).toMatchObject({
      success: false,
      error: { code: 'PREINSTALL_PROTECTED', message: '不能覆盖预装技能' },
    });
  });

  it('blocks direct writes but leaves save_user_skill allowed', async () => {
    const deps = dependencies();
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'guard',
      mode: 'interactive',
      userPrompt: '普通问题',
      entries: [{ common: stoUserSkillToolDefinition }],
      ...deps,
    });
    const preTool = result.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const denied = await preTool(preToolInput('write-1', 'Write', {
      file_path: 'D:/workspace/skills/demo/SKILL.md',
      content: 'demo',
    }), 'write-1', { signal: new AbortController().signal });
    expect(denied.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });

    const allowed = await preTool(preToolInput('save-1', 'save_user_skill', {
      skillMd: 'demo',
    }), 'save-1', { signal: new AbortController().signal });
    expect(allowed.hookSpecificOutput).toBeUndefined();

    const postTool = result.options.hooks?.PostToolUse?.[0]?.hooks[0] as HookCallback;
    await postTool({
      hook_event_name: 'PostToolUse',
      session_id: 'sdk-session',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/workspace',
      tool_name: 'Read',
      tool_input: { file_path: 'D:/workspace/skills/demo/SKILL.md' },
      tool_response: { content: 'demo' },
      tool_use_id: 'read-1',
    }, 'read-1', { signal: new AbortController().signal });
    expect(deps.port.scheduleOrphanImport).toHaveBeenCalledWith(
      'agent-extension-after-skill-path-tool',
    );
  });
});
