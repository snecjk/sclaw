import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAccess,
  mockMkdir,
  mockReadFile,
  mockWriteFile,
  mockListConfiguredAgentIds,
  mockResolveStoBaseUrl,
  mockGetOpenClawConfigDir,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockMkdir: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockListConfiguredAgentIds: vi.fn(),
  mockResolveStoBaseUrl: vi.fn(),
  mockGetOpenClawConfigDir: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  mkdir: mockMkdir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  default: {
    access: mockAccess,
    mkdir: mockMkdir,
    readFile: mockReadFile,
    writeFile: mockWriteFile,
  },
}));

vi.mock('@electron/utils/agent-config', () => ({
  listConfiguredAgentIds: mockListConfiguredAgentIds,
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderEnvVar: vi.fn(),
  getProviderDefaultModel: vi.fn(),
  getProviderConfig: vi.fn(),
}));

vi.mock('@electron/utils/provider-keys', () => ({
  OPENCLAW_PROVIDER_KEY_MOONSHOT: 'moonshot',
  isOAuthProviderType: vi.fn(),
  isOpenClawOAuthPluginProviderKey: vi.fn(),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock('@electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: mockResolveStoBaseUrl,
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: mockGetOpenClawConfigDir,
}));

describe('syncStoPluginsToOpenClaw', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockAccess.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({}));
    mockWriteFile.mockResolvedValue(undefined);
    mockListConfiguredAgentIds.mockResolvedValue(['main']);
    mockResolveStoBaseUrl.mockResolvedValue('https://sto.example.com');
    mockGetOpenClawConfigDir.mockReturnValue('/mock/openclaw');
  });

  it('writes sto-skill-call-monitor into plugins.allow and plugins.entries', async () => {
    const { syncStoPluginsToOpenClaw } = await import('@electron/utils/openclaw-auth');

    const wrote = await syncStoPluginsToOpenClaw();

    expect(wrote).toBe(true);
    expect(mockWriteFile).toHaveBeenCalled();
    const [, writtenJson] = mockWriteFile.mock.calls.at(-1) as [string, string];
    const writtenConfig = JSON.parse(writtenJson) as Record<string, any>;

    expect(writtenConfig.plugins.allow).toContain('sto-skill-call-monitor');
    expect(writtenConfig.plugins.allow).toContain('sto-media-understanding');
    expect(writtenConfig.plugins.allow).toContain('sto-workflow-tool');
    expect(writtenConfig.plugins.allow).toContain('sto-user-skill-tool');
    expect(writtenConfig.plugins.allow).toContain('sto-browser-bridge');
    expect(writtenConfig.plugins.allow).not.toContain('sto-distinctive-design-guard');
    // baseUrl 是桌面端 Host API（见 sto-workflow-tool/openclaw.plugin.json 的 schema 描述），
    // 不是 STO 远端；远端地址只用于遥测/技能上报类插件。
    expect(writtenConfig.plugins.entries['sto-workflow-tool']).toEqual({
      enabled: true,
      config: {
        baseUrl: 'http://127.0.0.1:3210',
        ssoAuthPath: '~/.stoclaw/openclaw/sso-auth.json',
        timeoutMs: 30000,
      },
    });
    expect(writtenConfig.plugins.entries['sto-user-skill-tool']).toEqual({
      enabled: true,
      config: {
        hostApiHost: '127.0.0.1',
        hostApiPort: 3210,
        timeoutMs: 60_000,
      },
    });
    expect(writtenConfig.plugins.entries['sto-skill-call-monitor']).toEqual({
      enabled: true,
      config: {
        reportApiUrl: 'https://sto.example.com/agent/v1/skills/usage-report',
        ssoAuthPath: '~/.stoclaw/openclaw/sso-auth.json',
        timeoutMs: 5000,
      },
    });
    expect(writtenConfig.plugins.entries['sto-media-understanding']).toEqual({
      enabled: true,
      config: {},
    });
    expect(writtenConfig.plugins.entries['sto-browser-bridge']).toEqual({
      enabled: true,
      config: {
        hostApiHost: '127.0.0.1',
        hostApiPort: 3210,
        commandTimeoutMs: 30_000,
      },
    });
  });

  it('skips rewriting openclaw.json when STO plugins config is unchanged', async () => {
    const { syncStoPluginsToOpenClaw } = await import('@electron/utils/openclaw-auth');

    await syncStoPluginsToOpenClaw();
    const writeCountAfterFirst = mockWriteFile.mock.calls.length;
    expect(writeCountAfterFirst).toBeGreaterThan(0);

    const [, writtenJson] = mockWriteFile.mock.calls.at(-1) as [string, string];
    mockReadFile.mockResolvedValue(writtenJson);
    mockWriteFile.mockClear();

    const wroteAgain = await syncStoPluginsToOpenClaw();

    expect(wroteAgain).toBe(false);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
