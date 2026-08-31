import { describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  createSclawCapabilityToken,
  createSclawActivationEvaluator,
  buildSclawPrompt,
  runSclawAfterToolPolicies,
  runSclawBeforeToolPolicies,
  type SclawExtensionBuildContext,
  type SclawExtensionDiagnostic,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import {
  typeBoxObjectToZodRawShape,
  typeBoxSchemaToZod,
  UnsupportedSclawToolSchemaError,
} from '../../electron/agent-extensions/schema/typebox-to-zod';
import {
  SCLAW_AGENT_EXTENSIONS,
  validateAgentExtensionRegistry,
} from '../../electron/agent-extensions/registry';

const logger: SclawExtensionLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function context(stateManager: SclawExtensionStateManager): SclawExtensionBuildContext {
  return {
    engine: 'pi',
    sessionKey: 'session-1',
    mode: 'interactive',
    commandShell: 'bash',
    capabilities: new SclawCapabilityRegistry(),
    state: stateManager.forExtension('session-1', 'test-extension'),
    logger,
  };
}

describe('agent extension core', () => {
  it('resolves typed capabilities and reports missing required values', () => {
    const token = createSclawCapabilityToken<{ value: number }>('test.value');
    const capabilities = new SclawCapabilityRegistry();
    expect(capabilities.has(token)).toBe(false);
    expect(() => capabilities.require(token)).toThrow('test.value');
    capabilities.provide(token, { value: 7 });
    expect(capabilities.require(token).value).toBe(7);
  });

  it('isolates session, turn, and tool-call state', () => {
    const manager = new SclawExtensionStateManager();
    manager.beginTurn('session-1');
    const state = manager.forExtension('session-1', 'test-extension');
    state.session.set('stable', 1);
    state.turn.set('temporary', 2);
    state.toolCall('call-1').set('pending', 3);

    manager.beginTurn('session-1');
    const next = manager.forExtension('session-1', 'test-extension');
    expect(next.session.get('stable')).toBe(1);
    expect(next.turn.get('temporary')).toBeUndefined();
    expect(next.toolCall('call-1').get('pending')).toBeUndefined();

    manager.clearSession('session-1');
    expect(manager.forExtension('session-1', 'test-extension').session.get('stable')).toBeUndefined();
  });

  it('runs patches in order, denies immediately, and fails closed', async () => {
    const stateManager = new SclawExtensionStateManager();
    const later = vi.fn();
    const decision = await runSclawBeforeToolPolicies('test-extension', [
      {
        id: 'patch',
        beforeTool: (event) => ({ action: 'patch', input: { ...event.input, patched: true } }),
      },
      {
        id: 'deny',
        beforeTool: (event) => event.input.patched
          ? { action: 'deny', reason: 'blocked' }
          : { action: 'allow' },
      },
      { id: 'later', beforeTool: later },
    ], {
      rawToolName: 'Bash',
      toolName: 'bash',
      toolKind: 'shell',
      toolCallId: 'call-1',
      input: { command: 'echo ok' },
    }, context(stateManager));
    expect(decision).toEqual({ action: 'deny', reason: 'blocked' });
    expect(later).not.toHaveBeenCalled();

    const failure = await runSclawBeforeToolPolicies('test-extension', [{
      id: 'broken',
      beforeTool: () => { throw new Error('policy failed'); },
    }], {
      rawToolName: 'Bash',
      toolName: 'bash',
      toolKind: 'shell',
      toolCallId: 'call-2',
      input: {},
    }, context(stateManager));
    expect(failure).toMatchObject({ action: 'deny' });
  });

  it('keeps tool results when an after-tool observer fails', async () => {
    const stateManager = new SclawExtensionStateManager();
    const second = vi.fn();
    await expect(runSclawAfterToolPolicies('test-extension', [
      { id: 'broken', afterTool: () => { throw new Error('observer failed'); } },
      { id: 'second', afterTool: second },
    ], {
      rawToolName: 'echo',
      toolName: 'echo',
      toolKind: 'other',
      toolCallId: 'call-1',
      input: {},
      isError: false,
      result: { ok: true },
    }, context(stateManager))).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledOnce();
  });

  it('skips a failed prompt contribution and keeps the remaining prompt', async () => {
    const diagnostics: SclawExtensionDiagnostic[] = [];
    await expect(buildSclawPrompt('test-extension', [
      { id: 'broken', build: () => { throw new Error('prompt failed'); } },
      { id: 'healthy', text: 'healthy prompt' },
    ], context(new SclawExtensionStateManager()), diagnostics))
      .resolves.toBe('healthy prompt');
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'PROMPT_BUILD_FAILED' }));
  });

  it('evaluates activation once and keeps session matches isolated by session', async () => {
    const stateManager = new SclawExtensionStateManager();
    const diagnostics: SclawExtensionDiagnostic[] = [];
    const match = vi.fn((buildContext: SclawExtensionBuildContext) => ({
      active: buildContext.userPrompt === 'activate',
      reason: 'test-match',
    }));
    const activation = { id: 'lazy-tools', scope: 'session' as const, match };

    const firstContext = { ...context(stateManager), userPrompt: 'activate' };
    const first = createSclawActivationEvaluator({
      extensionId: 'test-extension', activations: [activation], context: firstContext, diagnostics,
    });
    expect((await first('lazy-tools')).active).toBe(true);
    expect((await first('lazy-tools')).active).toBe(true);
    expect(match).toHaveBeenCalledOnce();

    const followUp = createSclawActivationEvaluator({
      extensionId: 'test-extension',
      activations: [activation],
      context: { ...context(stateManager), userPrompt: 'follow-up' },
      diagnostics,
    });
    expect(await followUp('lazy-tools')).toMatchObject({ active: true, source: 'session-cache' });
    expect(match).toHaveBeenCalledOnce();

    const separateManager = new SclawExtensionStateManager();
    const separate = createSclawActivationEvaluator({
      extensionId: 'test-extension',
      activations: [activation],
      context: { ...context(separateManager), userPrompt: 'follow-up' },
      diagnostics,
    });
    expect((await separate('lazy-tools')).active).toBe(false);
  });

  it('fails activation closed and records a diagnostic once', async () => {
    const diagnostics: SclawExtensionDiagnostic[] = [];
    const evaluate = createSclawActivationEvaluator({
      extensionId: 'test-extension',
      activations: [{ id: 'broken', scope: 'turn', match: () => { throw new Error('broken matcher'); } }],
      context: context(new SclawExtensionStateManager()),
      diagnostics,
    });
    expect(await evaluate('broken')).toMatchObject({ active: false, source: 'error' });
    expect(await evaluate('broken')).toMatchObject({ active: false, source: 'error' });
    expect(diagnostics.filter((item) => item.code === 'ACTIVATION_MATCH_FAILED')).toHaveLength(1);
  });
});

describe('TypeBox to Zod conversion', () => {
  it('converts nested objects, arrays, records, optional fields, and literal unions', () => {
    const schema = Type.Object({
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      tags: Type.Array(Type.String()),
      mode: Type.Union([Type.Literal('fast'), Type.Literal('safe')]),
      values: Type.Record(Type.String(), Type.Unknown()),
    });
    const converted = typeBoxSchemaToZod(schema);
    expect(converted.parse({ query: 'hello', tags: [], mode: 'safe', values: { a: 1 } })).toEqual({
      query: 'hello', tags: [], mode: 'safe', values: { a: 1 },
    });
    expect(() => converted.parse({ query: '', tags: [], mode: 'other', values: {} })).toThrow();
    expect(Object.keys(typeBoxObjectToZodRawShape(schema))).toEqual(['query', 'limit', 'tags', 'mode', 'values']);
  });

  it('rejects unsupported schema types with a precise path', () => {
    expect(() => typeBoxSchemaToZod({ type: 'date' } as never, '$.createdAt'))
      .toThrow(UnsupportedSclawToolSchemaError);
    expect(() => typeBoxSchemaToZod({ type: 'date' } as never, '$.createdAt'))
      .toThrow('$.createdAt');
  });
});

describe('agent extension registry validation', () => {
  it('registers the migrated production extensions', () => {
    expect(SCLAW_AGENT_EXTENSIONS.map((entry) => entry.common.id))
      .toEqual([
        'claw-scheduled-path-guard',
        'sto-browser-tool',
        'sto-scheduled-task-tool',
        'sto-workflow-tool',
        'sto-dingtalk-send-guard',
        'sto-user-skill-tool',
      ]);
    expect(SCLAW_AGENT_EXTENSIONS[0].common.engines).toEqual(['pi']);
    expect(SCLAW_AGENT_EXTENSIONS[1].common.engines).toEqual(['claude', 'pi']);
    expect(SCLAW_AGENT_EXTENSIONS[2].common.engines).toBeUndefined();
    expect(SCLAW_AGENT_EXTENSIONS[3].common.engines).toEqual(['claude']);
    expect(SCLAW_AGENT_EXTENSIONS[4].common.engines).toEqual(['claude', 'pi']);
    expect(SCLAW_AGENT_EXTENSIONS[5].common.engines).toEqual(['claude', 'pi']);
    expect(SCLAW_AGENT_EXTENSIONS.every((entry) => entry.native == null)).toBe(true);
  });

  it('reports duplicate extension and tool names plus augment collisions', () => {
    const tool = {
      name: 'echo',
      label: 'Echo',
      description: 'Echo input',
      parameters: Type.Object({ text: Type.String() }),
      execute: async () => ({ success: true as const, type: 'echo', domain: 'test', data: {} }),
    };
    const diagnostics = validateAgentExtensionRegistry([
      { common: { id: 'duplicate', version: '1.0.0', tools: [tool] } },
      {
        common: { id: 'duplicate', version: '1.0.0', tools: [tool] },
        native: {
          pi: {
            mode: 'augment',
            claims: { tools: ['echo'] },
            build: () => [],
          },
        },
      },
    ]);
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'DUPLICATE_EXTENSION_ID',
      'DUPLICATE_TOOL_NAME',
      'NATIVE_TOOL_COLLISION',
    ]));
  });

  it('rejects invalid extension, tool, and native resource names', () => {
    const diagnostics = validateAgentExtensionRegistry([{
      common: {
        id: 'Invalid Extension',
        version: '1.0.0',
        tools: [{
          name: 'bad tool',
          label: 'Bad',
          description: 'Invalid test tool',
          parameters: Type.Object({}),
          execute: async () => ({ success: true, type: 'ok', domain: 'test', data: null }),
        }],
      },
      native: {
        claude: {
          mode: 'augment',
          claims: { mcpServers: ['bad server'] },
          build: () => ({}),
        },
      },
    }]);
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'INVALID_EXTENSION_ID',
      'INVALID_TOOL_NAME',
      'INVALID_NATIVE_RESOURCE_NAME',
    ]));
  });

  it('rejects duplicate activations and unknown contribution references', () => {
    const match = () => false;
    const diagnostics = validateAgentExtensionRegistry([{
      common: {
        id: 'activation-validation',
        version: '1.0.0',
        activations: [
          { id: 'lazy', scope: 'session', match },
          { id: 'lazy', scope: 'turn', match },
        ],
        prompts: [{ id: 'prompt', activation: 'missing', text: 'prompt' }],
      },
    }]);
    expect(diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'DUPLICATE_ACTIVATION_ID',
      'UNKNOWN_ACTIVATION_REFERENCE',
    ]));
  });
});
