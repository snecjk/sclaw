import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
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
  STO_SKILL_RUNTIME_CAPABILITY,
  StoSkillRuntimePortError,
  type StoSkillRuntimePort,
} from '../../electron/agent-extensions/extensions/sto-skill-runtime/capability';
import {
  USER_SKILL_SYSTEM_PROMPT,
  stoSkillRuntimeDefinition,
} from '../../electron/agent-extensions/extensions/sto-skill-runtime/definition';

const logger: SclawExtensionLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
};

function dependencies() {
  const port: StoSkillRuntimePort = {
    delete: vi.fn(async ({ slug }) => ({ ok: true, slug, scope: 'user', userCode: 'u-1' })),
    search: vi.fn(async () => ({
      query: 'demo', items: [], totalEnabled: 0, degraded: false,
    })),
    recordRead: vi.fn(async () => ({ slug: 'demo-skill', recorded: true as const })),
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
    capabilities: new SclawCapabilityRegistry().provide(STO_SKILL_RUNTIME_CAPABILITY, port),
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

describe('sto-skill-runtime user-skill contributions', () => {
  it('exposes an executable Claude MCP save tool with its qualified name on rename', async () => {
    const deps = dependencies();
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-rename-wire', mode: 'interactive',
      userPrompt: '这个技能名称改成：上海天气',
      entries: [{ common: stoSkillRuntimeDefinition }], ...deps,
    });
    expect(result.options.systemPromptAppend).toContain('mcp__sto-skill-runtime__save_user_skill');
    const server = result.options.mcpServers?.['sto-skill-runtime'];
    if (!server || server.type !== 'sdk') throw new Error('missing SDK MCP server');
    const client = new Client({ name: 'regression', version: '1.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.instance.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain('save_user_skill');
      expect(listed.tools.map((tool) => tool.name)).toContain('delete_user_skill');
      const deleted = await client.callTool({ name: 'delete_user_skill', arguments: { slug: 'demo-skill' } });
      expect(deleted.isError).not.toBe(true);
      expect(deps.port.delete).toHaveBeenCalledWith({ slug: 'demo-skill' });
      const response = await client.callTool({
        name: 'save_user_skill', arguments: {
          slug: 'demo-skill', name: '上海天气',
          skillMd: '---\nname: demo-skill\ndescription: demo\n---\n',
        },
      });
      expect(response.isError).not.toBe(true);
      expect(deps.port.save).toHaveBeenCalledWith(expect.objectContaining({ name: '上海天气' }));
    } finally {
      await client.close();
      await server.instance.close();
    }
  });

  it.each(['删除这个技能', '把天气技能删掉', '卸载天气技能', '移除这个技能', '帮我改这个技能', '这个技能帮我改个名字', '帮我改下天气技能的名称', '把这个技能的名称改成上海天气', '重命名天气技能', '技能名字换成上海天气'])('activates for natural rename wording: %s', async (userPrompt) => {
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'rename', mode: 'interactive', userPrompt,
      entries: [{ common: stoSkillRuntimeDefinition }], ...dependencies(),
    });
    expect(result.options.systemPromptAppend).toContain(USER_SKILL_SYSTEM_PROMPT);
  });

  it('enables the Pi save tool after a blocked write without enabling it in another chat', async () => {
    const deps = dependencies();
    const result = await buildPiAgentExtensions({
      sessionKey: 'blocked-write', mode: 'interactive',
      entries: [{ common: stoSkillRuntimeDefinition }], ...deps,
    });
    const activeTools = [...result.initiallyActiveToolNames];
    const handlers = new Map<string, (event: Record<string, unknown>) => unknown>();
    for (const extension of result.extensions) {
      if (typeof extension === 'function' || extension.name !== 'sto-skill-runtime') continue;
      await extension.factory({
        registerTool() {},
        on(event: string, handler: (event: Record<string, unknown>) => unknown) { handlers.set(event, handler); },
        getActiveTools() { return activeTools; },
        setActiveTools(names: string[]) { activeTools.splice(0, activeTools.length, ...names); },
      } as never);
    }
    expect(activeTools).not.toContain('save_user_skill');
    const denied = await handlers.get('tool_call')?.({
      toolName: 'edit', toolCallId: 'edit-1', input: { path: 'D:/skills/demo/SKILL.md' },
    });
    expect(denied).toMatchObject({ block: true });
    expect(activeTools).toContain('save_user_skill');
    const other = await buildClaudeAgentExtensions({
      sessionKey: 'another-chat', mode: 'interactive', userPrompt: '名字换成上海天气',
      entries: [{ common: stoSkillRuntimeDefinition }], ...deps,
    });
    expect(other.options.systemPromptAppend).not.toContain(USER_SKILL_SYSTEM_PROMPT);
  });

  it('activates the Claude save tool and guidance on skill intent', async () => {
    const deps = dependencies();
    const entries = [{ common: stoSkillRuntimeDefinition }];
    expect(stoSkillRuntimeDefinition.tools).toHaveLength(3);
    const saveTool = stoSkillRuntimeDefinition.tools?.find((tool) => tool.name === 'save_user_skill');
    expect(saveTool?.parameters).toBeDefined();
    typeBoxObjectToZodRawShape(saveTool!.parameters);
    const unrelated = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '分析一下这个项目',
      entries,
      ...deps,
    });
    expect(unrelated.options.mcpServers?.['sto-skill-runtime']).toBeDefined();
    expect(unrelated.options.systemPromptAppend).not.toContain(USER_SKILL_SYSTEM_PROMPT);
    expect(unrelated.options.hooks?.PreToolUse).toBeDefined();

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '把这个流程整理成一个用户技能',
      entries,
      ...deps,
    });
    expect(matched.diagnostics).toEqual([]);
    expect(matched.options.mcpServers?.['sto-skill-runtime']).toBeDefined();
    expect(matched.options.systemPromptAppend).toContain(USER_SKILL_SYSTEM_PROMPT);

    const followUp = await buildClaudeAgentExtensions({
      sessionKey: 'user-skill-lazy',
      mode: 'interactive',
      userPrompt: '名字改成 demo',
      entries,
      ...deps,
    });
    expect(followUp.options.mcpServers?.['sto-skill-runtime']).toBeDefined();
  });

  it('keeps the Pi save tool executable after the runtime is rebuilt for the same chat', async () => {
    const deps = dependencies();
    for (const userPrompt of ['帮我生成一个技能', '名字换成上海天气']) {
      const result = await buildPiAgentExtensions({
        sessionKey: 'pi-user-skill',
        mode: 'interactive',
        entries: [{ common: stoSkillRuntimeDefinition }],
        ...deps,
      });
      const activeTools = [...result.initiallyActiveToolNames];
      expect(activeTools).not.toContain('save_user_skill');
      const registered = new Map<string, Parameters<ExtensionAPI['registerTool']>[0]>();
      const handlers = new Map<string, (event: Record<string, unknown>) => unknown>();
      const extension = result.extensions.find(
        (item) => typeof item !== 'function' && item.name === 'sto-skill-runtime',
      );
      if (!extension || typeof extension === 'function') throw new Error('missing extension');
      await extension.factory({
        registerTool(tool: Parameters<ExtensionAPI['registerTool']>[0]) { registered.set(tool.name, tool); },
        on(event: string, handler: (event: Record<string, unknown>) => unknown) { handlers.set(event, handler); },
        getActiveTools() { return activeTools; },
        setActiveTools(names: string[]) { activeTools.splice(0, activeTools.length, ...names); },
      } as never);
      const prompt = await handlers.get('before_agent_start')?.({
        prompt: userPrompt,
        systemPrompt: 'base',
        systemPromptOptions: {},
      }) as { systemPrompt?: string } | undefined;
      expect(prompt?.systemPrompt).toContain(USER_SKILL_SYSTEM_PROMPT);
      expect(activeTools).toContain('save_user_skill');
      const save = registered.get('save_user_skill');
      expect(save).toBeDefined();
      const response = await save!.execute('save-call', {
        slug: 'demo-skill',
        name: '上海天气',
        skillMd: '---\nname: demo-skill\ndescription: demo\n---\n',
      }, undefined, undefined, {} as never);
      expect(response.isError).not.toBe(true);
      expect(deps.port.save).toHaveBeenCalledWith(expect.objectContaining({ name: '上海天气' }));
      // Runtime replacement discards extension state even for the same chat key.
      // A resource/config reload preserves session-scoped activation state.
      deps.stateManager.endTurn('pi-user-skill');
    }
    expect(deps.port.save).toHaveBeenCalledTimes(2);
  });

  it('returns the common success envelope and preserves Host API error codes', async () => {
    const deps = dependencies();
    const tool = stoSkillRuntimeDefinition.tools?.find((item) => item.name === 'save_user_skill');
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
      new StoSkillRuntimePortError('PREINSTALL_PROTECTED', '不能覆盖预装技能'),
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
      entries: [{ common: stoSkillRuntimeDefinition }],
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
