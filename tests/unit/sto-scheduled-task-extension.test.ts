import { describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { SCHEDULED_TASK_CORE_PROMPT } from '../../shared/scheduled-task-instruction';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import {
  STO_SCHEDULED_TASK_CAPABILITY,
  type StoScheduledTaskPort,
} from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/capability';
import {
  STO_SCHEDULED_TASK_SYSTEM_PROMPT,
  stoScheduledTaskToolDefinition,
} from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/definition';
import { matchesStoScheduledTaskManagementIntent } from '../../electron/agent-extensions/extensions/sto-scheduled-task-tool/activation';

const expectedTools = [
  'create_sto_scheduled_task',
  'list_sto_scheduled_tasks',
  'get_sto_scheduled_task',
  'update_sto_scheduled_task',
  'delete_sto_scheduled_task',
  'trigger_sto_scheduled_task',
];

function dependencies() {
  const port: StoScheduledTaskPort = {
    resolveDefaults: vi.fn(async () => ({ agentId: 'main', workspacePath: 'D:/workspace' })),
    list: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    trigger: vi.fn(),
  };
  const logger: SclawExtensionLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  return {
    port,
    logger,
    capabilities: new SclawCapabilityRegistry().provide(STO_SCHEDULED_TASK_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
  };
}

function matchesIntent(userPrompt: string): boolean {
  const deps = dependencies();
  return matchesStoScheduledTaskManagementIntent({
    engine: 'pi',
    sessionKey: 'agent:main:intent-test',
    mode: 'interactive',
    commandShell: 'bash',
    userPrompt,
    capabilities: deps.capabilities,
    state: deps.stateManager.forExtension('agent:main:intent-test', 'sto-scheduled-task-tool'),
    logger: deps.logger,
  }).active;
}

describe('sto scheduled-task activation matcher', () => {
  it.each([
    '你有定时任务工具吗',
    '列出我的计划任务',
    '每天九点生成日报',
    '工作日下班前发送汇总',
    '用 cron 每周跑一次检查',
  ])('activates for %s', (prompt) => {
    expect(matchesIntent(prompt)).toBe(true);
  });

  it.each([
    '帮我分析这个项目',
    '制定下一季度项目计划',
    '整理研发任务规划',
    '今天生成一份日报',
  ])('does not activate for %s', (prompt) => {
    expect(matchesIntent(prompt)).toBe(false);
  });
});

describe('sto-scheduled-task-tool common extension', () => {
  it('registers the same common tool names for Claude and PI', async () => {
    const deps = dependencies();
    const entries = [{ common: stoScheduledTaskToolDefinition }];
    const claude = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      userPrompt: '列出我的定时任务',
      entries,
      ...deps,
    });
    const server = claude.options.mcpServers?.['sto-scheduled-task-tool'] as unknown as {
      instance: { _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual(expectedTools);
    expect(claude.options.systemPromptAppend).toContain(STO_SCHEDULED_TASK_SYSTEM_PROMPT);

    const pi = await buildPiAgentExtensions({
      sessionKey: 'agent:main:chat', mode: 'interactive', entries, ...deps,
    });
    expect(pi.initiallyActiveToolNames).toEqual([]);
    const registered: string[] = [];
    const handlers = new Map<string, (...args: never[]) => unknown>();
    let activeTools = ['read', 'bash'];
    const common = pi.extensions.find(
      (extension) => typeof extension !== 'function' && extension.name === 'sto-scheduled-task-tool',
    );
    if (!common || typeof common === 'function') throw new Error('missing PI common extension');
    await common.factory({
      registerTool(tool) { registered.push(tool.name); },
      on(event, handler) { handlers.set(event, handler as never); },
      getActiveTools() { return activeTools; },
      setActiveTools(names) { activeTools = names; },
    } as never);
    expect(registered).toEqual(expectedTools);
    const prompt = await handlers.get('before_agent_start')?.({
      prompt: '列出我的定时任务', systemPrompt: 'base', systemPromptOptions: {},
    } as never) as { systemPrompt?: string } | undefined;
    expect(activeTools).toEqual(['read', 'bash', ...expectedTools]);
    expect(prompt?.systemPrompt).toContain(STO_SCHEDULED_TASK_SYSTEM_PROMPT);
  });

  it('keeps management tools out of unrelated sessions and sticks after a match', async () => {
    const deps = dependencies();
    const entries = [{ common: stoScheduledTaskToolDefinition }];
    const first = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:lazy-chat',
      mode: 'interactive',
      userPrompt: '帮我分析这个项目',
      entries,
      ...deps,
    });
    expect(first.options.mcpServers).toBeUndefined();
    expect(first.options.systemPromptAppend).toBeUndefined();
    expect(first.options.hooks?.PreToolUse).toBeDefined();

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:lazy-chat',
      mode: 'interactive',
      userPrompt: '每天九点生成日报',
      entries,
      ...deps,
    });
    expect(matched.options.mcpServers?.['sto-scheduled-task-tool']).toBeDefined();

    const followUp = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:lazy-chat',
      mode: 'interactive',
      userPrompt: '改成下午三点',
      entries,
      ...deps,
    });
    expect(followUp.options.mcpServers?.['sto-scheduled-task-tool']).toBeDefined();

    const separateSession = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:separate-chat',
      mode: 'interactive',
      userPrompt: '改成下午三点',
      entries,
      ...deps,
    });
    expect(separateSession.options.mcpServers).toBeUndefined();
  });

  it('hides management tools and switches to execution prompt in scheduled sessions', async () => {
    const deps = dependencies();
    const entries = [{ common: stoScheduledTaskToolDefinition }];
    const claude = await buildClaudeAgentExtensions({
      sessionKey: 'claude-task:t1:2026-08-29', mode: 'scheduled', entries, ...deps,
    });
    expect(claude.options.mcpServers).toBeUndefined();
    expect(claude.options.systemPromptAppend).toBe(SCHEDULED_TASK_CORE_PROMPT);

    const pi = await buildPiAgentExtensions({
      sessionKey: 'agent:main:scheduled-task:t1:2026-08-29', mode: 'scheduled', entries, ...deps,
    });
    expect(pi.initiallyActiveToolNames).toEqual([]);
    const registered: string[] = [];
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const common = pi.extensions.find(
      (extension) => typeof extension !== 'function' && extension.name === 'sto-scheduled-task-tool',
    );
    if (!common || typeof common === 'function') throw new Error('missing PI common extension');
    await common.factory({
      registerTool(tool) { registered.push(tool.name); },
      on(event, handler) { handlers.set(event, handler as never); },
    } as never);
    expect(registered).toEqual([]);
    const prompt = await handlers.get('before_agent_start')?.({
      prompt: 'run', systemPrompt: 'base', systemPromptOptions: {},
    } as never) as { systemPrompt?: string } | undefined;
    expect(prompt?.systemPrompt).toBe(`base\n\n${SCHEDULED_TASK_CORE_PROMPT}`);
  });

  it('skips the extension with a diagnostic when its capability is absent', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      entries: [{ common: stoScheduledTaskToolDefinition }],
      capabilities: new SclawCapabilityRegistry(),
      stateManager: new SclawExtensionStateManager(),
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      extensionId: 'sto-scheduled-task-tool',
      code: 'MISSING_CAPABILITY',
      contributionId: 'sto.scheduled-task',
    }));
  });

  it.each(['claude', 'pi'] as const)('creates a task for the active %s engine through the common Port', async (engine) => {
    const deps = dependencies();
    vi.mocked(deps.port.create).mockResolvedValue({ id: `task-${engine}`, engineType: engine } as never);
    vi.mocked(deps.port.resolveDefaults).mockResolvedValue({
      accountId: 'account-1', agentId: 'main', model: 'model-1', workspacePath: 'D:/workspace',
    });
    const create = stoScheduledTaskToolDefinition.tools?.find(
      (tool) => tool.name === 'create_sto_scheduled_task',
    );
    if (!create) throw new Error('missing create tool');
    const state = deps.stateManager.forExtension('agent:main:chat', 'sto-scheduled-task-tool');
    const outcome = await create.execute({
      name: '日报', promptTemplate: '生成日报', cronExpr: '0 9 * * *',
    }, {
      engine,
      sessionKey: 'agent:main:chat',
      mode: 'interactive',
      commandShell: engine === 'pi' ? 'powershell' : 'bash',
      toolCallId: 'tool-create',
      capabilities: deps.capabilities,
      state,
      logger: deps.logger,
    });
    expect(outcome.success).toBe(true);
    expect(deps.port.create).toHaveBeenCalledWith(expect.objectContaining({
      engineType: engine,
      agentId: 'main',
      workspacePath: 'D:/workspace',
      model: 'model-1',
      accountId: 'account-1',
    }));
    expect(vi.mocked(deps.port.create).mock.calls[0]?.[0]).not.toHaveProperty('permissionProfile');
  });
});
