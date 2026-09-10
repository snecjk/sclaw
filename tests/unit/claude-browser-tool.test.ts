import { describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import {
  PI_AGENT_EXTENSIONS,
  selectPiAgentExtensions,
} from '../../electron/agent-extensions/adapters/pi/registry';
import {
  STO_BROWSER_BRIDGE_CAPABILITY,
  type StoBrowserBridgePort,
} from '../../electron/agent-extensions/extensions/sto-browser-tool/capability';
import { stoBrowserToolDefinition } from '../../electron/agent-extensions/extensions/sto-browser-tool/definition';
import {
  BRIDGE_SYSTEM_PROMPT,
  EMBED_BRIDGE_SYSTEM_PROMPT,
} from '../../electron/agent-extensions/extensions/sto-browser-tool/prompts';

const expectedTools = [
  'bridge_snapshot', 'bridge_click', 'bridge_fill', 'bridge_navigate',
  'bridge_screenshot', 'bridge_list_sessions',
];
const logger: SclawExtensionLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
};

function dependencies() {
  const port: StoBrowserBridgePort = {
    listSessions: vi.fn(async () => [{
      sessionId: 'embed-other', tabId: -1, url: 'https://embed.example',
      title: 'Embed', source: 'embed',
    }, {
      sessionId: 'chrome-1', tabId: 7, url: 'https://example.com',
      title: 'Chrome', source: 'extension',
    }]),
    ensureSession: vi.fn(async () => 'chrome-1'),
    runCommand: vi.fn(async (input) => ({ ok: true, action: input.action })),
  };
  return {
    port,
    capabilities: new SclawCapabilityRegistry().provide(STO_BROWSER_BRIDGE_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
    logger,
  };
}

function executionContext(deps: ReturnType<typeof dependencies>, sessionKey: string) {
  return {
    engine: 'claude' as const,
    sessionKey,
    mode: 'interactive' as const,
    commandShell: 'powershell' as const,
    capabilities: deps.capabilities,
    state: deps.stateManager.beginTurn(sessionKey),
    logger,
    toolCallId: 'browser-1',
  };
}

describe('sto-browser-tool common extension', () => {
  it('lazily compiles all six tools for ordinary Claude chat', async () => {
    const deps = dependencies();
    const entries = [{ common: stoBrowserToolDefinition }];
    const unrelated = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:ordinary-browser', mode: 'interactive',
      userPrompt: '分析这个项目', entries, ...deps,
    });
    expect(unrelated.options.mcpServers).toBeUndefined();
    expect(unrelated.options.systemPromptAppend).toBeUndefined();

    const matched = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:ordinary-browser', mode: 'interactive',
      userPrompt: '点击当前浏览器页面里的客户管理菜单', entries, ...deps,
    });
    const server = matched.options.mcpServers?.['sto-browser-tool'] as unknown as {
      instance: { _registeredTools: Record<string, unknown> };
    };
    expect(Object.keys(server.instance._registeredTools)).toEqual(expectedTools);
    expect(matched.options.systemPromptAppend).toContain(BRIDGE_SYSTEM_PROMPT);
  });

  it('automatically activates the embed prompt and removes the ba_* contradiction', async () => {
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'agent:main:session-embed-app-teambition--abc',
      mode: 'interactive', entries: [{ common: stoBrowserToolDefinition }],
      ...dependencies(),
    });
    expect(result.options.mcpServers?.['sto-browser-tool']).toBeDefined();
    expect(result.options.systemPromptAppend).toContain(EMBED_BRIDGE_SYSTEM_PROMPT);
    expect(result.options.systemPromptAppend).toContain('同一任务不要混用两套工具');
    expect(result.options.systemPromptAppend).not.toContain('仅使用 bridge_*');
  });

  it('does not expose bridge tools to ordinary PI sessions', async () => {
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-browser', mode: 'interactive',
      entries: [{ common: stoBrowserToolDefinition }], ...dependencies(),
    });
    expect(result.initiallyActiveToolNames).toEqual([]);
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle']);
  });

  it('uses sto-browser-tool instead of pi-browser-use for App Plaza PI sessions', async () => {
    const sessionKey = 'agent:main:session-embed-app-teambition--abc';
    const selectedIds = selectPiAgentExtensions(sessionKey, PI_AGENT_EXTENSIONS)
      .map((entry) => entry.common.id);
    expect(selectedIds).toContain('sto-browser-tool');
    expect(selectedIds).not.toContain('pi-browser-use');

    const result = await buildPiAgentExtensions({
      sessionKey,
      mode: 'interactive',
      entries: [{ common: stoBrowserToolDefinition }],
      ...dependencies(),
    });
    expect(result.extensions.map((item) => typeof item === 'function' ? 'anonymous' : item.name))
      .toEqual(['sclaw-extension-lifecycle', 'sto-browser-tool']);
  });

  it('keeps pi-browser-use and excludes sto-browser-tool for ordinary PI sessions', () => {
    const selectedIds = selectPiAgentExtensions('agent:main:ordinary', PI_AGENT_EXTENSIONS)
      .map((entry) => entry.common.id);
    expect(selectedIds).toContain('pi-browser-use');
    expect(selectedIds).not.toContain('sto-browser-tool');
  });

  it('requires an explicit embed session and never falls back to another page', async () => {
    const deps = dependencies();
    const click = stoBrowserToolDefinition.tools?.find((item) => item.name === 'bridge_click');
    if (!click) throw new Error('missing bridge_click');
    const context = executionContext(deps, 'agent:main:session-embed-app-teambition--abc');

    expect(await click.execute({ name: '客户管理' }, context)).toMatchObject({
      success: false, error: { code: 'EMBED_SESSION_ID_REQUIRED' },
    });
    expect(await click.execute({ sessionId: 'chrome-1', name: '客户管理' }, context))
      .toMatchObject({ success: false, error: { code: 'EMBED_SESSION_ID_INVALID' } });
    expect(deps.port.runCommand).not.toHaveBeenCalled();

    expect(await click.execute({
      sessionId: 'embed-runtime-1', name: '客户管理',
    }, context)).toMatchObject({ success: true, domain: 'browser-bridge' });
    expect(deps.port.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'embed-runtime-1', action: 'click', payload: { name: '客户管理' },
    }));
  });

  it('selects external Chrome instead of an unrelated embed for ordinary chat', async () => {
    const deps = dependencies();
    const snapshot = stoBrowserToolDefinition.tools?.find(
      (item) => item.name === 'bridge_snapshot',
    );
    if (!snapshot) throw new Error('missing bridge_snapshot');
    expect(await snapshot.execute({}, executionContext(deps, 'agent:main:ordinary')))
      .toMatchObject({ success: true });
    expect(deps.port.runCommand).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'chrome-1', action: 'snapshot',
    }));
  });
});
