import { describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  createSclawCapabilityToken,
  type SclawAgentExtensionDefinition,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import type { RegisteredAgentExtension } from '../../electron/agent-extensions/registry';

const logger: SclawExtensionLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function definition(): SclawAgentExtensionDefinition {
  return {
    id: 'synthetic-extension',
    version: '1.0.0',
    tools: [{
      name: 'synthetic_echo',
      label: 'Synthetic Echo',
      description: 'Echo synthetic input',
      parameters: Type.Object({ text: Type.String() }),
      async execute(params, context) {
        return {
          success: true,
          type: 'synthetic_echo_result',
          domain: 'synthetic',
          data: { text: params.text, engine: context.engine },
        };
      },
    }],
    prompts: [
      { id: 'shared', text: 'shared prompt' },
      { id: 'claude-only', engines: ['claude'], text: 'claude prompt' },
    ],
    policies: [{
      id: 'patch-bash',
      beforeTool(event) {
        if (event.toolName !== 'bash') return { action: 'allow' };
        return { action: 'patch', input: { ...event.input, patched: true } };
      },
    }],
  };
}

function dependencies() {
  return {
    capabilities: new SclawCapabilityRegistry(),
    stateManager: new SclawExtensionStateManager(),
    logger,
  };
}

describe('Claude agent extension adapter', () => {
  it('compiles common tools, prompts, and policies', async () => {
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-session',
      mode: 'interactive',
      entries: [{ common: definition() }],
      ...dependencies(),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.options.mcpServers?.['synthetic-extension']).toBeDefined();
    expect(result.options.systemPromptAppend).toBe('shared prompt\n\nclaude prompt');
    expect(logger.info).toHaveBeenCalledWith('[agent-extension] build.start', expect.objectContaining({
      engine: 'claude',
      sessionKey: 'claude-session',
    }));
    expect(logger.info).toHaveBeenCalledWith('[agent-extension] build.completed', expect.objectContaining({
      engine: 'claude',
      diagnostics: 0,
    }));

    const callback = result.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const hookResult = await callback({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/workspace',
      tool_name: 'Bash',
      tool_input: { command: 'echo ok' },
      tool_use_id: 'tool-1',
    }, 'tool-1', { signal: new AbortController().signal });
    expect(hookResult?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      updatedInput: { command: 'echo ok', patched: true },
    });

    const server = result.options.mcpServers?.['synthetic-extension'] as unknown as {
      instance: { _registeredTools: Record<string, { handler(args: unknown, extra: unknown): Promise<unknown> }> };
    };
    const toolResult = await server.instance._registeredTools.synthetic_echo.handler({ text: 'hello' }, {});
    expect(JSON.parse((toolResult as { content: Array<{ text: string }> }).content[0].text)).toMatchObject({
      success: true,
      data: { text: 'hello', engine: 'claude' },
    });
    expect(logger.info).toHaveBeenCalledWith('[agent-extension] tool.execute.completed', expect.objectContaining({
      engine: 'claude',
      extensionId: 'synthetic-extension',
      toolName: 'synthetic_echo',
      success: true,
    }));
  });

  it('supports native augment and replace modes without silent collisions', async () => {
    const augment: RegisteredAgentExtension = {
      common: definition(),
      native: {
        claude: {
          mode: 'augment',
          build: () => ({ systemPromptAppend: 'native prompt' }),
        },
      },
    };
    const augmented = await buildClaudeAgentExtensions({
      sessionKey: 'augment', mode: 'interactive', entries: [augment], ...dependencies(),
    });
    expect(augmented.options.systemPromptAppend).toBe('shared prompt\n\nclaude prompt\n\nnative prompt');

    const replaced = await buildClaudeAgentExtensions({
      sessionKey: 'replace',
      mode: 'interactive',
      entries: [{
        common: definition(),
        native: { claude: { mode: 'replace', build: () => ({ systemPromptAppend: 'replacement' }) } },
      }],
      ...dependencies(),
    });
    expect(replaced.options.systemPromptAppend).toBe('replacement');
    expect(replaced.options.mcpServers).toBeUndefined();
  });

  it('skips missing capabilities and colliding native contributions', async () => {
    const required = createSclawCapabilityToken<{ ready: boolean }>('synthetic.required');
    const missing = await buildClaudeAgentExtensions({
      sessionKey: 'missing',
      mode: 'interactive',
      entries: [{ common: { ...definition(), requiredCapabilities: [required] } }],
      ...dependencies(),
    });
    expect(missing.options.mcpServers).toBeUndefined();
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'MISSING_CAPABILITY' }));

    const collision = await buildClaudeAgentExtensions({
      sessionKey: 'collision',
      mode: 'interactive',
      entries: [{
        common: definition(),
        native: {
          claude: {
            mode: 'augment',
            claims: { tools: ['synthetic_echo'] },
            build: () => ({ systemPromptAppend: 'must not load' }),
          },
        },
      }],
      ...dependencies(),
    });
    expect(collision.options.systemPromptAppend).not.toContain('must not load');
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: 'NATIVE_CONTRIBUTION_COLLISION',
    }));
  });

  it('filters common tools and policies by engine', async () => {
    const selective: SclawAgentExtensionDefinition = {
      id: 'selective-extension',
      version: '1.0.0',
      tools: [
        {
          name: 'claude_only',
          label: 'Claude only',
          description: 'Claude tool',
          engines: ['claude'],
          parameters: Type.Object({}),
          async execute() {
            return { success: true, type: 'ok', domain: 'synthetic', data: null };
          },
        },
        {
          name: 'pi_only',
          label: 'Pi only',
          description: 'Pi tool',
          engines: ['pi'],
          parameters: Type.Object({}),
          async execute() {
            return { success: true, type: 'ok', domain: 'synthetic', data: null };
          },
        },
      ],
      policies: [{
        id: 'pi-policy',
        engines: ['pi'],
        beforeTool: () => ({ action: 'deny', reason: 'pi-only policy' }),
      }],
    };
    const claude = await buildClaudeAgentExtensions({
      sessionKey: 'selective-claude',
      mode: 'interactive',
      entries: [{ common: selective }],
      ...dependencies(),
    });
    const server = claude.options.mcpServers?.['selective-extension'] as unknown as {
      instance: { _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual(['claude_only']);
    expect(claude.options.hooks).toBeUndefined();

    const pi = await buildPiAgentExtensions({
      sessionKey: 'selective-pi',
      mode: 'interactive',
      entries: [{ common: selective }],
      ...dependencies(),
    });
    expect(pi.extensions).toHaveLength(2);
  });
});

describe('Pi agent extension adapter', () => {
  it('compiles common tools, prompts, and policies into InlineExtension', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-session',
      mode: 'interactive',
      entries: [{ common: definition() }],
      ...dependencies(),
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'synthetic-extension']);
    expect(logger.info).toHaveBeenCalledWith('[agent-extension] build.completed', expect.objectContaining({
      engine: 'pi',
      diagnostics: 0,
    }));

    type FakeHandler = (event: Record<string, unknown>) => Promise<unknown> | unknown;
    type FakeTool = {
      name: string;
      execute(
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
      ): Promise<{ details: Record<string, unknown> }>;
    };
    const handlers = new Map<string, FakeHandler[]>();
    const registeredTools: FakeTool[] = [];
    const pi = {
      registerTool: (tool: FakeTool) => registeredTools.push(tool),
      on: (event: string, handler: FakeHandler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
    };
    for (const extension of result.extensions) {
      const factory = typeof extension === 'function' ? extension : extension.factory;
      await factory(pi as never);
    }

    expect(registeredTools.map((tool) => tool.name)).toEqual(['synthetic_echo']);
    const toolResult = await registeredTools[0].execute(
      'tool-1', { text: 'hello' }, new AbortController().signal,
    );
    expect(toolResult.details).toMatchObject({ data: { text: 'hello', engine: 'pi' } });

    const input = { command: 'echo ok' };
    const beforeResult = await handlers.get('tool_call')?.[0]?.({
      type: 'tool_call', toolName: 'bash', toolCallId: 'tool-2', input,
    });
    expect(beforeResult).toBeUndefined();
    expect(input).toEqual({ command: 'echo ok', patched: true });

    const promptResult = await handlers.get('before_agent_start')?.[0]?.({
      type: 'before_agent_start', prompt: 'hello', systemPrompt: 'base', systemPromptOptions: {},
    });
    expect(promptResult).toEqual({ systemPrompt: 'base\n\nshared prompt' });
  });

  it('uses only the native PI contribution in replace mode', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-replace',
      mode: 'interactive',
      entries: [{
        common: definition(),
        native: {
          pi: {
            mode: 'replace',
            build: () => ({ name: 'pi-native', factory: () => {} }),
          },
        },
      }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'pi-native']);
  });

  it('appends native PI contributions in augment mode', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-augment',
      mode: 'interactive',
      entries: [{
        common: definition(),
        native: {
          pi: {
            mode: 'augment',
            build: () => ({ name: 'pi-native', factory: () => {} }),
          },
        },
      }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'synthetic-extension', 'pi-native']);
  });

  it('throws a controlled error carrying the common failure envelope', async () => {
    const failedDefinition: SclawAgentExtensionDefinition = {
      id: 'failed-extension',
      version: '1.0.0',
      tools: [{
        name: 'always_fails',
        label: 'Always fails',
        description: 'Returns a controlled failure',
        parameters: Type.Object({}),
        async execute() {
          return {
            success: false,
            type: 'sto_tool_error',
            domain: 'synthetic',
            error: { code: 'synthetic_failure', message: 'expected failure' },
          };
        },
      }],
    };
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-failure', mode: 'interactive', entries: [{ common: failedDefinition }], ...dependencies(),
    });
    let execute: ((toolCallId: string, params: object, signal: AbortSignal) => Promise<unknown>) | undefined;
    const commonExtension = result.extensions.find(
      (item) => typeof item !== 'function' && item.name === 'failed-extension',
    );
    if (!commonExtension || typeof commonExtension === 'function') throw new Error('missing common extension');
    await commonExtension.factory({
      registerTool(tool) {
        execute = tool.execute;
      },
      on() {},
    } as never);
    await expect(execute?.('tool-failure', {}, new AbortController().signal)).rejects.toMatchObject({
      name: 'SclawToolExecutionError',
      code: 'synthetic_failure',
      outcome: { success: false, error: { code: 'synthetic_failure' } },
    });
  });
});
