import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockCpSync,
  mockMkdirSync,
  mockRmSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockReaddirSync,
  mockRealpathSync,
  mockLstatSync,
  mockReadlinkSync,
  mockSymlinkSync,
  mockLoggerWarn,
  mockLoggerInfo,
  mockHomedir,
  mockApp,
  mockGetOpenClawDir,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockRealpathSync: vi.fn(),
  mockLstatSync: vi.fn(),
  mockReadlinkSync: vi.fn(),
  mockSymlinkSync: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockHomedir: vi.fn(() => '/home/test'),
  mockApp: {
    isPackaged: true,
    getAppPath: vi.fn(() => '/mock/app'),
  },
  mockGetOpenClawDir: vi.fn(() => '/mock/openclaw'),
}));

const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform');

vi.mock('node:fs', () => {
  const mocked = {
    existsSync: mockExistsSync,
    cpSync: mockCpSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    readdirSync: mockReaddirSync,
    realpathSync: mockRealpathSync,
    lstatSync: mockLstatSync,
    readlinkSync: mockReadlinkSync,
    symlinkSync: mockSymlinkSync,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('node:os', () => ({
  homedir: () => mockHomedir(),
  default: {
    homedir: () => mockHomedir(),
  },
}));

vi.mock('electron', () => ({
  app: mockApp,
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: mockGetOpenClawDir,
  getOpenClawConfigDir: () => '/home/test/.stoclaw/openclaw',
  getOpenClawNodeModulesPath: () => '/mock/app/node_modules',
  getBundledPluginSourceCandidates: () => [],
}));

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

describe('plugin installer diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockApp.isPackaged = true;
    mockHomedir.mockReturnValue('/home/test');
    setPlatform('linux');

    mockExistsSync.mockReturnValue(false);
    mockCpSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
    mockRmSync.mockImplementation(() => undefined);
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockReaddirSync.mockReturnValue([]);
    mockRealpathSync.mockImplementation((input: string) => input);
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false });
    mockReadlinkSync.mockReturnValue('');
    mockSymlinkSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR);
    }
  });

  it('prefers the checked-out workflow extension over an equal-version bundled copy in development', async () => {
    const localManifestSuffix = 'sto-plugin/openclaw/sto-workflow-tool/openclaw.plugin.json';
    mockExistsSync.mockImplementation((input: string) => (
      String(input).replace(/\\/g, '/').endsWith(localManifestSuffix)
    ));

    const { resolveStoWorkflowToolDevSyncSource } = await import('@electron/utils/plugin-install');

    expect(
      resolveStoWorkflowToolDevSyncSource(['/bundle/sto-workflow-tool'])?.replace(/\\/g, '/'),
    ).toBe(`${process.cwd().replace(/\\/g, '/')}/sto-plugin/openclaw/sto-workflow-tool`);
  });

  it('runs the workflow-specific source sync during async development startup', async () => {
    mockApp.isPackaged = false;
    const localRoot = `${process.cwd().replace(/\\/g, '/')}/sto-plugin/openclaw/sto-workflow-tool`;
    const installedManifest = '/home/test/.stoclaw/openclaw/extensions/sto-workflow-tool/openclaw.plugin.json';
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input).replace(/\\/g, '/');
      return path.startsWith(`${localRoot}/`) || path === installedManifest;
    });

    const { ensureAllBundledPluginsInstalledAsync } = await import('@electron/utils/plugin-install');
    await ensureAllBundledPluginsInstalledAsync();

    expect(mockCpSync.mock.calls.some(([source, target, options]) => (
      String(source).replace(/\\/g, '/').endsWith('/sto-plugin/openclaw/sto-workflow-tool/index.ts')
      && String(target).replace(/\\/g, '/').endsWith('/extensions/sto-workflow-tool/index.ts')
      && options?.force === true
    ))).toBe(true);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('[plugin] Synced sto-workflow-tool dev sources'),
    );
  });

  it('returns source-missing warning when bundled mirror cannot be found', async () => {
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled(
      'sto-scheduled-task-tool',
      ['/bundle/sto-scheduled-task-tool'],
      'STO Scheduled Task Tool',
    );

    expect(result.installed).toBe(false);
    expect(result.warning).toContain('Bundled STO Scheduled Task Tool plugin mirror not found');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('retries once on Windows and logs diagnostic details when bundled copy fails', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\StoClaw\\resources\\openclaw-plugins\\sto-scheduled-task-tool';
    const sourceManifestSuffix = 'openclaw-plugins\\sto-scheduled-task-tool\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input).includes('openclaw-plugins\\sto-scheduled-task-tool\\package.json')) {
        return JSON.stringify({ version: '1.2.3' });
      }
      return '{}';
    });
    mockCpSync.mockImplementation(() => {
      const error = new Error('path too long') as NodeJS.ErrnoException;
      error.code = 'ENAMETOOLONG';
      throw error;
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('sto-scheduled-task-tool', [sourceDir], 'STO Scheduled Task Tool');

    expect(result).toEqual({
      installed: false,
      warning: 'Failed to install bundled STO Scheduled Task Tool plugin mirror',
    });

    expect(mockCpSync).toHaveBeenCalledTimes(2);
    const [firstSourcePath, firstTargetPath] = mockCpSync.mock.calls[0] as [string, string];
    expect(firstSourcePath.startsWith('\\\\?\\')).toBe(true);
    expect(firstTargetPath.startsWith('\\\\?\\')).toBe(true);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for STO Scheduled Task Tool',
      expect.objectContaining({
        pluginDirName: 'sto-scheduled-task-tool',
        pluginLabel: 'STO Scheduled Task Tool',
        sourceDir,
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'ENAMETOOLONG' }),
          expect.objectContaining({ attempt: 2, code: 'ENAMETOOLONG' }),
        ],
      }),
    );
  });

  it('logs EPERM diagnostics with source and target paths', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\StoClaw\\resources\\openclaw-plugins\\sto-scheduled-task-tool';
    const sourceManifestSuffix = 'openclaw-plugins\\sto-scheduled-task-tool\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input).includes('openclaw-plugins\\sto-scheduled-task-tool\\package.json')) {
        return JSON.stringify({ version: '1.2.3' });
      }
      return '{}';
    });
    mockCpSync.mockImplementation(() => {
      const error = new Error('access denied') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });

    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('sto-scheduled-task-tool', [sourceDir], 'STO Scheduled Task Tool');

    expect(result.installed).toBe(false);
    expect(result.warning).toBe('Failed to install bundled STO Scheduled Task Tool plugin mirror');

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for STO Scheduled Task Tool',
      expect.objectContaining({
        sourceDir,
        targetDir: '/home/test/.stoclaw/openclaw/extensions/sto-scheduled-task-tool',
        platform: 'win32',
        attempts: [
          expect.objectContaining({ attempt: 1, code: 'EPERM' }),
          expect.objectContaining({ attempt: 2, code: 'EPERM' }),
        ],
      }),
    );
  });

  it('exposes sto-skill-call-monitor as a bundled local plugin installer', async () => {
    const pluginInstall = await import('@electron/utils/plugin-install');

    expect(typeof pluginInstall.ensureStoSkillCallMonitorPluginInstalled).toBe('function');
  });
});

describe('channel plugin runtime layout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetOpenClawDir.mockReturnValue('/mock/openclaw');
    mockRealpathSync.mockImplementation((input: string) => input);
  });

  it('treats non-channel plugins as layout-complete', async () => {
    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('sto-workflow-tool', '/any')).toBe(true);
  });

  it('treats retired OC channel plugins as layout-complete (no npm channel plugins left)', async () => {
    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', '/any')).toBe(true);
    expect(channelPluginRuntimeLayoutComplete('wecom', '/any')).toBe(true);
    expect(channelPluginRuntimeLayoutComplete('qqbot', '/any')).toBe(true);
  });

  it('retired WeChat/WeCom/QQ ensure* helpers refuse install', async () => {
    const pluginInstall = await import('@electron/utils/plugin-install');
    expect(pluginInstall.ensureWeChatPluginInstalled().installed).toBe(false);
    expect(pluginInstall.ensureWeComPluginInstalled().installed).toBe(false);
    expect(pluginInstall.ensureQQBotPluginInstalled().installed).toBe(false);
  });
});
