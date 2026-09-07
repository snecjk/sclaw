import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/stoclaw-agent-config-${suffix}`,
    testUserData: `/tmp/stoclaw-agent-config-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.stoclaw', 'openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('uses the cloud default engine when creating an Agent', async () => {
    await writeOpenClawJson({});

    const { createAgent } = await import('@electron/utils/agent-config');
    const snapshot = await createAgent('Cloud Default', { defaultEngine: 'pi' });

    expect(snapshot.agents.find((agent) => agent.id === 'cloud-default')?.engineType).toBe('pi');
  });

  it('uses the local default engine when no valid cloud default is supplied', async () => {
    await writeOpenClawJson({});

    const { createAgentWithId } = await import('@electron/utils/agent-config');
    const snapshot = await createAgentWithId('local-fallback', 'Local Fallback', {
      defaultEngine: 'unsupported-engine',
    });

    expect(snapshot.agents.find((agent) => agent.id === 'local-fallback')?.engineType).toBe('claude');
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('removes the legacy unsupported skipBootstrap property when ensuring an agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'workflow-runtime', name: 'Workflow Runtime', workspace: '/old-workspace', skipBootstrap: true },
        ],
      },
    });

    const { createAgentWithId } = await import('@electron/utils/agent-config');
    await createAgentWithId('workflow-runtime', 'Workflow Runtime', { workspace: '/workflow-runtime' });

    const config = await readOpenClawJson();
    const agent = (config.agents as { list: Array<Record<string, unknown>> }).list
      .find((entry) => entry.id === 'workflow-runtime');
    expect(agent).toMatchObject({ id: 'workflow-runtime', workspace: '/workflow-runtime' });
    expect(agent).not.toHaveProperty('skipBootstrap');
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.5',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.stoclaw/openclaw/workspace',
            agentDir: '~/.stoclaw/openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.stoclaw/openclaw/workspace-test2',
            agentDir: '~/.stoclaw/openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.stoclaw/openclaw/workspace-test3',
            agentDir: '~/.stoclaw/openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        dingtalk: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'dingtalk',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.stoclaw', 'openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.stoclaw', 'openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    const { snapshot } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.dingtalk).toBe('main');

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // Workspace deletion is intentionally deferred by `deleteAgentConfig` to avoid
    // ENOENT errors during Gateway restart, so it should still exist here.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    infoSpy.mockRestore();
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.stoclaw/openclaw/workspace',
            agentDir: '~/.stoclaw/openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.stoclaw/openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.stoclaw', 'openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    await deleteAgentConfig('test2');

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        dingtalk: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'dingtalk',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const dingtalk = (config.channels as Record<string, unknown>).dingtalk as {
      accounts?: Record<string, unknown>;
    };
    expect(dingtalk.accounts?.test2).toBeDefined();
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        dingtalk: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'dingtalk', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['dingtalk:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('replaces previous account binding for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        dingtalk: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'dingtalk', 'default');
    await assignChannelAccountToAgent('main', 'dingtalk', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['dingtalk:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['dingtalk:alt']).toBe('main');
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        dingtalk: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'dingtalk', 'default');
    await assignChannelAccountToAgent('test2', 'dingtalk', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['dingtalk:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        dingtalk: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'dingtalk', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('dingtalk', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['dingtalk:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('atomically saves WeChat channel config and default main binding', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
    });

    const { saveWeChatChannelWithBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await saveWeChatChannelWithBinding('bot-im-bot', 'main');

    const config = await readOpenClawJson();
    const wechat = config.channels as Record<string, {
      defaultAccount?: string;
      enabled?: boolean;
      accounts?: Record<string, { enabled?: boolean }>;
    }>;
    expect(wechat['openclaw-weixin']).toMatchObject({
      defaultAccount: 'bot-im-bot',
      enabled: true,
      accounts: {
        'bot-im-bot': { enabled: true },
      },
    });
    expect((config.plugins as { entries?: Record<string, { enabled?: boolean }> }).entries?.['openclaw-weixin']).toEqual({
      enabled: true,
    });
    expect(config.bindings).toEqual([
      {
        agentId: 'main',
        match: {
          channel: 'openclaw-weixin',
          accountId: 'bot-im-bot',
        },
      },
    ]);

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['openclaw-weixin:bot-im-bot']).toBe('main');
  });
});
