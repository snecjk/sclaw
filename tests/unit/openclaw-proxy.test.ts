import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readOpenClawConfigMock,
  writeOpenClawConfigMock,
  withConfigLockMock,
} = vi.hoisted(() => ({
  readOpenClawConfigMock: vi.fn(),
  writeOpenClawConfigMock: vi.fn(),
  withConfigLockMock: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: readOpenClawConfigMock,
  writeOpenClawConfig: writeOpenClawConfigMock,
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: withConfigLockMock,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('syncProxyConfigToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readOpenClawConfigMock.mockResolvedValue({
      channels: {
        telegram: {
          botToken: 'token',
          proxy: 'socks5://127.0.0.1:7891',
        },
      },
    });
  });

  it('is a no-op after retired OC channel proxy sync removal', async () => {
    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw({
      proxyEnabled: false,
      proxyServer: '',
      proxyHttpServer: '',
      proxyHttpsServer: '',
      proxyAllServer: '',
      proxyBypassRules: '',
    });

    expect(readOpenClawConfigMock).not.toHaveBeenCalled();
    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
  });

  it('does not clear legacy telegram proxy even when preserveExistingWhenDisabled is false', async () => {
    const { syncProxyConfigToOpenClaw } = await import('@electron/utils/openclaw-proxy');

    await syncProxyConfigToOpenClaw(
      {
        proxyEnabled: false,
        proxyServer: '',
        proxyHttpServer: '',
        proxyHttpsServer: '',
        proxyAllServer: '',
        proxyBypassRules: '',
      },
      { preserveExistingWhenDisabled: false },
    );

    expect(writeOpenClawConfigMock).not.toHaveBeenCalled();
  });
});
