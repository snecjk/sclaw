import { describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import {
  STO_WORKFLOW_CAPABILITY,
  type StoWorkflowPort,
} from '../../electron/agent-extensions/extensions/sto-workflow-tool/capability';
import {
  STO_WORKFLOW_SYSTEM_PROMPT,
  stoWorkflowToolDefinition,
} from '../../electron/agent-extensions/extensions/sto-workflow-tool/definition';

const expectedTools = [
  'search_workflow_templates',
  'get_workflow_schema',
  'create_workflow',
  'execute_workflow',
  'get_workflow_status',
];

function dependencies(available = true) {
  const port: StoWorkflowPort = {
    isAvailable: vi.fn(async () => available),
    searchTemplates: vi.fn(async () => []),
    getStartupSchema: vi.fn(),
    createWorkflow: vi.fn(),
    startWorkflow: vi.fn(),
    getRun: vi.fn(),
  };
  const logger: SclawExtensionLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  };
  return {
    port,
    logger,
    capabilities: new SclawCapabilityRegistry().provide(STO_WORKFLOW_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
  };
}

describe('sto-workflow-tool common extension', () => {
  it('lazily registers the five Claude tools and keeps activation for the session', async () => {
    const deps = dependencies();
    const entries = [{ common: stoWorkflowToolDefinition }];
    const first = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:workflow-lazy',
      mode: 'interactive',
      userPrompt: '帮我分析这个项目',
      entries,
      ...deps,
    });
    expect(first.options.mcpServers).toBeUndefined();
    expect(first.options.systemPromptAppend).toBeUndefined();
    expect(first.options.hooks?.PreToolUse).toBeDefined();
    expect(deps.port.isAvailable).not.toHaveBeenCalled();

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:workflow-lazy',
      mode: 'interactive',
      userPrompt: '帮我创建一个审批工作流',
      entries,
      ...deps,
    });
    const server = matched.options.mcpServers?.['sto-workflow-tool'] as unknown as {
      instance: { _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual(expectedTools);
    expect(matched.options.systemPromptAppend).toContain(STO_WORKFLOW_SYSTEM_PROMPT);

    const followUp = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:workflow-lazy',
      mode: 'interactive',
      userPrompt: '就用第一个',
      entries,
      ...deps,
    });
    expect(followUp.options.mcpServers?.['sto-workflow-tool']).toBeDefined();
    expect(deps.port.isAvailable).toHaveBeenCalledTimes(1);
  });

  it('does not activate when STO authentication is unavailable', async () => {
    const deps = dependencies(false);
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:no-auth',
      mode: 'interactive',
      userPrompt: '列出工作流模板',
      entries: [{ common: stoWorkflowToolDefinition }],
      ...deps,
    });
    expect(result.options.mcpServers).toBeUndefined();
    expect(result.options.systemPromptAppend).toBeUndefined();
  });

  it('preserves the current PI workflow boundary', async () => {
    const deps = dependencies();
    const result = await buildPiAgentExtensions({
      sessionKey: 'agent:main:pi-workflow',
      mode: 'interactive',
      entries: [{ common: stoWorkflowToolDefinition }],
      ...deps,
    });
    expect(result.extensions).toEqual([]);
    expect(result.registeredToolNames).toEqual([]);
    expect(deps.port.isAvailable).not.toHaveBeenCalled();
  });

  it('returns the common envelope and routes execution metadata through the Port', async () => {
    const deps = dependencies();
    vi.mocked(deps.port.startWorkflow).mockResolvedValue({
      runId: 'run-1', workflowId: 'wf-1', status: 'running', startedAt: '2026-08-30T10:00:00Z',
    });
    const execute = stoWorkflowToolDefinition.tools?.find((tool) => tool.name === 'execute_workflow');
    if (!execute) throw new Error('missing execute_workflow');
    const outcome = await execute.execute({
      workflowId: 'wf-1', inputs: { city: '上海' }, templateName: '天气审批',
    }, {
      engine: 'claude',
      sessionKey: 'agent:main:workflow-run',
      mode: 'interactive',
      commandShell: 'bash',
      toolCallId: 'tool-start',
      capabilities: deps.capabilities,
      state: deps.stateManager.forExtension('agent:main:workflow-run', 'sto-workflow-tool'),
      logger: deps.logger,
    });
    expect(outcome).toMatchObject({
      success: true,
      type: 'workflow_execution_started',
      domain: 'workflow',
      data: { workflowId: 'wf-1', runId: 'run-1', status: 'running' },
    });
    expect(deps.port.startWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: 'wf-1',
      sessionKey: 'agent:main:workflow-run',
      engineType: 'claude',
      inputs: { city: '上海' },
    }));
  });

  it('preserves search, schema, create, and status contracts through the common Port', async () => {
    const deps = dependencies();
    vi.mocked(deps.port.searchTemplates).mockResolvedValue([
      { id: 'tpl-1', label: '请假审批', matchScore: 0.98 },
    ]);
    vi.mocked(deps.port.getStartupSchema).mockResolvedValue({
      templateId: 'tpl-1',
      schemaHash: 'hash-1',
      schema: { fields: [{ key: 'days' }], steps: [], nodeId: 'node-1', enabled: true },
    });
    vi.mocked(deps.port.createWorkflow).mockResolvedValue({
      workflowId: 'wf-1', workflowName: '请假审批', defaultPresetId: 'preset-1',
      schemaHash: 'hash-1', startupValues: { days: 2 },
    });
    vi.mocked(deps.port.getRun).mockResolvedValue({
      runId: 'run-1', workflowId: 'wf-1', status: 'completed', result: { approved: true },
    });
    const context = {
      engine: 'claude' as const,
      sessionKey: 'agent:main:workflow-contract',
      mode: 'interactive' as const,
      commandShell: 'bash' as const,
      toolCallId: 'tool-contract',
      capabilities: deps.capabilities,
      state: deps.stateManager.forExtension('agent:main:workflow-contract', 'sto-workflow-tool'),
      logger: deps.logger,
    };
    const byName = (name: string) => {
      const found = stoWorkflowToolDefinition.tools?.find((tool) => tool.name === name);
      if (!found) throw new Error(`missing ${name}`);
      return found;
    };

    const search = await byName('search_workflow_templates').execute(
      { query: '请假', limit: 5 }, context,
    );
    expect(search).toMatchObject({
      success: true,
      type: 'workflow_templates_found',
      data: { templates: [{ id: 'tpl-1', templateId: 'tpl-1' }] },
    });
    expect(deps.port.searchTemplates).toHaveBeenCalledWith('请假', 5);

    const schema = await byName('get_workflow_schema').execute(
      { templateId: 'tpl-1' }, context,
    );
    expect(schema).toMatchObject({
      success: true,
      type: 'workflow_schema_ready',
      data: { templateId: 'tpl-1', schemaHash: 'hash-1' },
    });

    const created = await byName('create_workflow').execute({
      templateId: 'tpl-1', schemaHash: 'hash-1', values: { days: 2 }, displayName: '我的请假',
    }, context);
    expect(created).toMatchObject({
      success: true,
      type: 'workflow_created',
      data: { workflowId: 'wf-1', values: { days: 2 } },
    });
    expect(deps.port.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl-1', schemaHash: 'hash-1', values: { days: 2 }, displayName: '我的请假',
    }));

    const status = await byName('get_workflow_status').execute({ runId: 'run-1' }, context);
    expect(status).toMatchObject({
      success: true,
      type: 'workflow_run_status',
      data: { runId: 'run-1', status: 'completed' },
    });
  });

  it('reports a missing capability instead of partially registering', async () => {
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:missing-workflow-port',
      mode: 'interactive',
      userPrompt: '创建工作流',
      entries: [{ common: stoWorkflowToolDefinition }],
      capabilities: new SclawCapabilityRegistry(),
      stateManager: new SclawExtensionStateManager(),
    });
    expect(result.options.mcpServers).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      extensionId: 'sto-workflow-tool',
      code: 'MISSING_CAPABILITY',
      contributionId: 'sto.workflow',
    }));
  });
});
