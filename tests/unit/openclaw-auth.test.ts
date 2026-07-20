import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/stoclaw-openclaw-auth-${suffix}`,
    testUserData: `/tmp/stoclaw-openclaw-auth-user-data-${suffix}`,
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

async function readAuthProfiles(agentId: string): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.stoclaw', 'openclaw', 'agents', agentId, 'agent', 'auth-profiles.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('saveProviderKeyToOpenClaw', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('only syncs auth profiles for configured agents', async () => {
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
            id: 'test3',
            name: 'test3',
            workspace: '~/.stoclaw/openclaw/workspace-test3',
            agentDir: '~/.stoclaw/openclaw/agents/test3/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.stoclaw', 'openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await writeFile(
      join(testHome, '.stoclaw', 'openclaw', 'agents', 'test2', 'agent', 'auth-profiles.json'),
      JSON.stringify({
        version: 1,
        profiles: {
          'legacy:default': {
            type: 'api_key',
            provider: 'legacy',
            key: 'legacy-key',
          },
        },
      }, null, 2),
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { saveProviderKeyToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await saveProviderKeyToOpenClaw('openrouter', 'sk-test');

    const mainProfiles = await readAuthProfiles('main');
    const test3Profiles = await readAuthProfiles('test3');
    const staleProfiles = await readAuthProfiles('test2');

    expect((mainProfiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect((test3Profiles.profiles as Record<string, { key: string }>)['openrouter:default'].key).toBe('sk-test');
    expect(staleProfiles.profiles).toEqual({
      'legacy:default': {
        type: 'api_key',
        provider: 'legacy',
        key: 'legacy-key',
      },
    });
    expect(logSpy).toHaveBeenCalledWith(
      'Saved API key for provider "openrouter" to OpenClaw auth-profiles (agents: main, test3)',
    );

    logSpy.mockRestore();
  });
});

describe('setOpenClawDefaultModelWithOverride main agent model ref', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('rewrites agents.list main model from bare id to qualified primary', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: { primary: 'qwen/old', fallbacks: [] },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.stoclaw/openclaw/workspace',
            agentDir: '~/.stoclaw/openclaw/agents/main/agent',
            model: 'qwen3.5-plus',
          },
        ],
      },
      models: { mode: 'merge', providers: {} },
      gateway: { mode: 'local' },
    });

    const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-auth');

    await setOpenClawDefaultModelWithOverride(
      'sto',
      'qwen3.5-plus',
      {
        baseUrl: 'https://baseinfo-aimemory.sto.cn/agent/v1',
        api: 'openai-completions',
      },
      [],
    );

    const raw = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
    const parsed = JSON.parse(raw) as { agents: { list: Array<{ id: string; model?: string }> } };
    const main = parsed.agents.list.find((e) => e.id === 'main');
    expect(main?.model).toBe('sto/qwen3.5-plus');
  });

  it('fills missing contextWindow and maxTokens for remote catalog models', async () => {
    await writeOpenClawJson({
      agents: { defaults: {}, list: [] },
      models: {
        mode: 'merge',
        providers: {
          sto: {
            baseUrl: 'https://old.example/v1',
            api: 'openai-completions',
            models: [{ id: 'qwen3.6-plus', name: 'qwen3.6-plus', input: ['text', 'image'] }],
          },
        },
      },
      gateway: { mode: 'local' },
    });

    const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-auth');
    await setOpenClawDefaultModelWithOverride(
      'sto',
      'qwen3.6-plus',
      {
        baseUrl: 'https://example.test/v1',
        api: 'openai-completions',
        providerModelIds: ['qwen3.6-plus'],
        defaultModelContextWindow: 256000,
        defaultModelMaxTokens: 32000,
      },
      [],
    );

    const raw = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      models: { providers: { sto: { models: Array<Record<string, unknown>> } } };
    };
    expect(parsed.models.providers.sto.models).toContainEqual(expect.objectContaining({
      id: 'qwen3.6-plus',
      contextWindow: 256000,
      maxTokens: 32000,
    }));
  });

  it('does not overwrite main agent model when already qualified', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: { primary: 'qwen/turbo', fallbacks: [] },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.stoclaw/openclaw/workspace',
            agentDir: '~/.stoclaw/openclaw/agents/main/agent',
            model: 'qwen/turbo',
          },
        ],
      },
      models: { mode: 'merge', providers: {} },
      gateway: { mode: 'local' },
    });

    const { setOpenClawDefaultModelWithOverride } = await import('@electron/utils/openclaw-auth');

    await setOpenClawDefaultModelWithOverride(
      'sto',
      'qwen3.5-plus',
      {
        baseUrl: 'https://baseinfo-aimemory.sto.cn/agent/v1',
        api: 'openai-completions',
      },
      [],
    );

    const raw = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
    const parsed = JSON.parse(raw) as { agents: { list: Array<{ id: string; model?: string }> } };
    const main = parsed.agents.list.find((e) => e.id === 'main');
    expect(main?.model).toBe('qwen/turbo');
  });
});

describe('syncGatewayTokenToConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  async function readConfig(): Promise<Record<string, any>> {
    const raw = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
    return JSON.parse(raw) as Record<string, any>;
  }

  it('persists an explicit empty gateway.tailscale to avoid phantom reload diffs', async () => {
    await writeOpenClawJson({ gateway: { mode: 'local' } });

    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-auth');
    await syncGatewayTokenToConfig('tok-123');

    const config = await readConfig();
    expect(config.gateway.tailscale).toEqual({});
    expect(config.gateway.auth).toEqual({ mode: 'token', token: 'tok-123' });
  });

  it('does not overwrite an existing gateway.tailscale config', async () => {
    await writeOpenClawJson({
      gateway: {
        mode: 'local',
        auth: { mode: 'token', token: 'tok-123' },
        controlUi: { allowedOrigins: ['file://'] },
        tailscale: { mode: 'serve' },
      },
    });

    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-auth');
    await syncGatewayTokenToConfig('tok-123');

    const config = await readConfig();
    expect(config.gateway.tailscale).toEqual({ mode: 'serve' });
  });

  it('is a no-op rewrite-free call when config is already in the desired state', async () => {
    await writeOpenClawJson({ gateway: { mode: 'local' } });

    const { syncGatewayTokenToConfig } = await import('@electron/utils/openclaw-auth');
    await syncGatewayTokenToConfig('tok-123');

    const configPath = join(testHome, '.stoclaw', 'openclaw', 'openclaw.json');
    const rawAfterFirst = await readFile(configPath, 'utf8');

    await syncGatewayTokenToConfig('tok-123');

    const rawAfterSecond = await readFile(configPath, 'utf8');
    expect(rawAfterSecond).toBe(rawAfterFirst);
  });
});
