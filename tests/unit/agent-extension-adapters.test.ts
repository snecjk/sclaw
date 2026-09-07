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
        if (event.toolName === 'read') return { action: 'allow', permissionDecision: 'allow' };
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
  it('skips the entire extension outside its declared session modes', async () => {
    const scoped = { ...definition(), modes: ['interactive'] as const };
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-scheduled',
      mode: 'scheduled',
      entries: [{ common: scoped }],
      ...dependencies(),
    });
    expect(result.options.mcpServers).toBeUndefined();
    expect(result.options.systemPromptAppend).toBeUndefined();
  });

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
    const readHookResult = await callback({
      hook_event_name: 'PreToolUse',
      session_id: 'sdk-session',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/workspace',
      tool_name: 'Read',
      tool_input: { file_path: 'D:/skills/runtime/SKILL.md' },
      tool_use_id: 'tool-read',
    }, 'tool-read', { signal: new AbortController().signal });
    expect(readHookResult?.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
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
  it('skips common and native contributions outside the declared session modes', async () => {
    const buildNative = vi.fn(() => ({ name: 'should-not-load', factory: () => {} }));
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-scheduled',
      mode: 'scheduled',
      entries: [{
        common: { ...definition(), modes: ['interactive'] },
        native: { pi: { mode: 'replace', build: buildNative } },
      }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle']);
    expect(buildNative).not.toHaveBeenCalled();
  });

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
    expect(result.initiallyActiveToolNames).toEqual(['synthetic_echo']);
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

    let systemPrompt = 'base';
    for (const handler of handlers.get('before_agent_start') ?? []) {
      const promptResult = await handler({
        type: 'before_agent_start', prompt: 'hello', systemPrompt, systemPromptOptions: {},
      }) as { systemPrompt?: string } | undefined;
      systemPrompt = promptResult?.systemPrompt ?? systemPrompt;
    }
    expect(systemPrompt).toBe('base\n\nshared prompt');

    result.setTurnContext({ runId: 'run-1' });
  });

  it('injects PI systemPromptAppend for one turn and clears it at turn end', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-turn-context',
      mode: 'interactive',
      entries: [{ common: definition() }],
      ...dependencies(),
    });
    type FakeHandler = (event: Record<string, unknown>) => Promise<unknown> | unknown;
    const handlers = new Map<string, FakeHandler[]>();
    const lifecycle = result.extensions.find(
      (extension) => typeof extension !== 'function' && extension.name === 'sclaw-extension-lifecycle',
    );
    if (!lifecycle || typeof lifecycle === 'function') throw new Error('missing PI lifecycle extension');
    await lifecycle.factory({
      on(event, handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler as FakeHandler]);
      },
    } as never);

    const beforeHandler = handlers.get('before_agent_start')?.[0];
    expect(await beforeHandler?.({
      type: 'before_agent_start', prompt: 'hello', systemPrompt: 'base', systemPromptOptions: {},
    })).toBeUndefined();

    result.setTurnContext({ runId: 'run-memory', systemPromptAppend: '  retrieved memory  ' });
    expect(await beforeHandler?.({
      type: 'before_agent_start', prompt: 'hello', systemPrompt: 'base', systemPromptOptions: {},
    })).toEqual({ systemPrompt: 'base\n\nretrieved memory' });

    await handlers.get('turn_end')?.[0]?.({ type: 'turn_end' });
    expect(await beforeHandler?.({
      type: 'before_agent_start', prompt: 'next', systemPrompt: 'base', systemPromptOptions: {},
    })).toBeUndefined();

    result.setTurnContext({ runId: 'run-next', systemPromptAppend: 'next memory' });
    expect(await beforeHandler?.({
      type: 'before_agent_start', prompt: 'next', systemPrompt: 'base', systemPromptOptions: {},
    })).toEqual({ systemPrompt: 'base\n\nnext memory' });
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
            claims: { tools: ['pi_native_tool'] },
            build: () => ({ name: 'pi-native', factory: () => {} }),
          },
        },
      }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'pi-native']);
    expect(result.initiallyActiveToolNames).toEqual(['pi_native_tool']);
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
            claims: { tools: ['pi_native_tool'] },
            build: () => ({ name: 'pi-native', factory: () => {} }),
          },
        },
      }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'synthetic-extension', 'pi-native']);
    expect(result.initiallyActiveToolNames).toEqual(['synthetic_echo', 'pi_native_tool']);
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

describe('agent extension lazy activation', () => {
  const lazyDefinition: SclawAgentExtensionDefinition = {
    id: 'lazy-synthetic-extension',
    version: '1.0.0',
    activations: [{
      id: 'lazy-domain',
      scope: 'session',
      match: (context) => context.userPrompt?.includes('lazy') ?? false,
    }],
    tools: [{
      name: 'lazy_synthetic_tool',
      label: 'Lazy synthetic tool',
      description: 'Only active after matching synthetic intent',
      activation: 'lazy-domain',
      parameters: Type.Object({}),
      async execute() {
        return { success: true, type: 'ok', domain: 'synthetic', data: null };
      },
    }],
    prompts: [{
      id: 'lazy-prompt',
      activation: 'lazy-domain',
      text: 'lazy synthetic prompt',
    }],
  };

  it('omits and then session-activates common Claude contributions', async () => {
    const deps = dependencies();
    const entries = [{ common: lazyDefinition }];
    const unmatched = await buildClaudeAgentExtensions({
      sessionKey: 'lazy-claude', mode: 'interactive', userPrompt: 'ordinary', entries, ...deps,
    });
    expect(unmatched.options).toEqual({});

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'lazy-claude', mode: 'interactive', userPrompt: 'use lazy tools', entries, ...deps,
    });
    expect(matched.options.mcpServers?.['lazy-synthetic-extension']).toBeDefined();
    expect(matched.options.systemPromptAppend).toBe('lazy synthetic prompt');

    const followUp = await buildClaudeAgentExtensions({
      sessionKey: 'lazy-claude', mode: 'interactive', userPrompt: 'continue', entries, ...deps,
    });
    expect(followUp.options.mcpServers?.['lazy-synthetic-extension']).toBeDefined();
  });

  it('registers lazy PI tools without initially exposing them, then activates them', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'lazy-pi', mode: 'interactive', entries: [{ common: lazyDefinition }], ...dependencies(),
    });
    expect(result.initiallyActiveToolNames).toEqual([]);

    const handlers = new Map<string, (event: Record<string, unknown>) => Promise<unknown>>();
    let activeTools = ['read', 'bash'];
    const extension = result.extensions.find(
      (item) => typeof item !== 'function' && item.name === 'lazy-synthetic-extension',
    );
    if (!extension || typeof extension === 'function') throw new Error('missing lazy PI extension');
    await extension.factory({
      registerTool() {},
      on(event, handler) { handlers.set(event, handler as never); },
      getActiveTools() { return activeTools; },
      setActiveTools(names) { activeTools = names; },
    } as never);

    const prompt = await handlers.get('before_agent_start')?.({
      prompt: 'use lazy tools', systemPrompt: 'base', systemPromptOptions: {},
    }) as { systemPrompt?: string } | undefined;
    expect(activeTools).toEqual(['read', 'bash', 'lazy_synthetic_tool']);
    expect(prompt?.systemPrompt).toBe('base\n\nlazy synthetic prompt');
  });

  it('preserves session activation across a Pi resource reload', async () => {
    const deps = dependencies();
    const result = await buildPiAgentExtensions({
      sessionKey: 'lazy-pi-reload', mode: 'interactive',
      entries: [{ common: lazyDefinition }], ...deps,
    });
    const handlers = new Map<string, (event: Record<string, unknown>) => Promise<unknown> | unknown>();
    let activeTools = ['read', 'bash'];
    for (const extension of result.extensions) {
      if (typeof extension === 'function') continue;
      await extension.factory({
        registerTool() {},
        on(event, handler) { handlers.set(event, handler as never); },
        getActiveTools() { return activeTools; },
        setActiveTools(names) { activeTools = names; },
      } as never);
    }

    await handlers.get('before_agent_start')?.({
      prompt: 'use lazy tools', systemPrompt: 'base', systemPromptOptions: {},
    });
    expect(activeTools).toContain('lazy_synthetic_tool');

    await handlers.get('session_shutdown')?.({ type: 'session_shutdown', reason: 'reload' });
    activeTools = ['read', 'bash'];
    const followUp = await handlers.get('before_agent_start')?.({
      prompt: 'continue', systemPrompt: 'base', systemPromptOptions: {},
    }) as { systemPrompt?: string } | undefined;

    expect(activeTools).toContain('lazy_synthetic_tool');
    expect(followUp?.systemPrompt).toBe('base\n\nlazy synthetic prompt');

    result.clearSessionState();
    activeTools = ['read', 'bash'];
    const afterDispose = await handlers.get('before_agent_start')?.({
      prompt: 'continue', systemPrompt: 'base', systemPromptOptions: {},
    }) as { systemPrompt?: string } | undefined;
    expect(activeTools).not.toContain('lazy_synthetic_tool');
    expect(afterDispose).toBeUndefined();
  });
});
