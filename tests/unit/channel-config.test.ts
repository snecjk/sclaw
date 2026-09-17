import { existsSync } from 'fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData, mockLoggerWarn, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/stoclaw-channel-config-${suffix}`,
    testUserData: `/tmp/stoclaw-channel-config-user-data-${suffix}`,
    mockLoggerWarn: vi.fn(),
    mockLoggerInfo: vi.fn(),
    mockLoggerError: vi.fn(),
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
    getAppPath: () => '/tmp',
  },
}));

vi.mock('@electron/utils/logger', () => ({
  warn: mockLoggerWarn,
  info: mockLoggerInfo,
  error: mockLoggerError,
}));

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('saveChannelConfig', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('persists string fields without OC-specific transforms or credential dedupe', async () => {
    const { saveChannelConfig } = await import('@electron/utils/channel-config');

    await saveChannelConfig(
      'dingtalk',
      { clientId: 'ding-123', clientSecret: 'secret-a' },
      'agent-a',
    );
    await expect(
      saveChannelConfig(
        'dingtalk',
        { clientId: '  ding-123  ', clientSecret: 'secret-b' },
        'agent-b',
      ),
    ).resolves.not.toThrow();

    const config = await readOpenClawJson();
    const channels = config.channels as Record<string, {
      clientId?: string;
      accounts: Record<string, { clientId?: string }>;
    }>;
    expect(channels.dingtalk.accounts['agent-a'].clientId).toBe('ding-123');
    expect(channels.dingtalk.accounts['agent-b'].clientId).toBe('  ding-123  ');
    expect(config.plugins).toBeUndefined();
  });
});

describe('parseDoctorValidationOutput', () => {
  it('extracts channel error and warning lines', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput(
      'dingtalk',
      'dingtalk error: token invalid\ndingtalk warning: fallback enabled\n',
    );

    expect(out.undetermined).toBe(false);
    expect(out.errors).toEqual(['dingtalk error: token invalid']);
    expect(out.warnings).toEqual(['dingtalk warning: fallback enabled']);
  });

  it('falls back with hint when output has no channel signal', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput('dingtalk', 'all good, no channel details');

    expect(out.undetermined).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w: string) => w.includes('falling back to local channel config checks'))).toBe(true);
  });

  it('falls back with hint when output is empty', async () => {
    const { parseDoctorValidationOutput } = await import('@electron/utils/channel-config');

    const out = parseDoctorValidationOutput('dingtalk', '   ');

    expect(out.undetermined).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w: string) => w.includes('falling back to local channel config checks'))).toBe(true);
  });
});

describe('WeChat dangling plugin cleanup', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes dangling openclaw-weixin plugin registration and state when no channel config exists', async () => {
    const { cleanupDanglingWeChatPluginState, writeOpenClawConfig } = await import('@electron/utils/channel-config');

    await writeOpenClawConfig({
      plugins: {
        enabled: true,
        allow: ['openclaw-weixin'],
        entries: {
          'openclaw-weixin': { enabled: true },
        },
      },
    });

    const staleStateDir = join(testHome, '.stoclaw', 'openclaw', 'openclaw-weixin', 'accounts');
    await mkdir(staleStateDir, { recursive: true });
    await writeFile(join(staleStateDir, 'bot-im-bot.json'), JSON.stringify({ token: 'stale-token' }), 'utf8');
    await writeFile(join(testHome, '.stoclaw', 'openclaw', 'openclaw-weixin', 'accounts.json'), JSON.stringify(['bot-im-bot']), 'utf8');

    const result = await cleanupDanglingWeChatPluginState();
    expect(result.cleanedDanglingState).toBe(true);

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
    expect(existsSync(join(testHome, '.stoclaw', 'openclaw', 'openclaw-weixin'))).toBe(false);
  });

  it('strips OC openclaw-weixin even when channels.openclaw-weixin still exists (Host Worker path)', async () => {
    const { cleanupDanglingWeChatPluginState, writeOpenClawConfig } = await import('@electron/utils/channel-config');

    await writeOpenClawConfig({
      channels: {
        'openclaw-weixin': {
          enabled: true,
          accounts: { 'bot-im-bot': { enabled: true } },
        },
      },
      plugins: {
        enabled: true,
        allow: ['openclaw-weixin'],
        entries: { 'openclaw-weixin': { enabled: true } },
      },
      bindings: [
        { agentId: 'main', match: { channel: 'openclaw-weixin', accountId: 'bot-im-bot' } },
      ],
    });

    const result = await cleanupDanglingWeChatPluginState();
    expect(result.cleanedDanglingState).toBe(true);

    const config = await readOpenClawJson();
    expect(config.channels?.['openclaw-weixin']).toBeUndefined();
    expect(config.plugins?.entries?.['openclaw-weixin']).toBeUndefined();
    expect(config.bindings).toBeUndefined();
  });
});
