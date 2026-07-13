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

  it('returns source-missing warning when bundled mirror cannot be found', async () => {
    const { ensurePluginInstalled } = await import('@electron/utils/plugin-install');
    const result = ensurePluginInstalled('wecom', ['/bundle/wecom'], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toContain('Bundled WeCom plugin mirror not found');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('retries once on Windows and logs diagnostic details when bundled copy fails', async () => {
    setPlatform('win32');
    mockHomedir.mockReturnValue('C:\\Users\\test');

    const sourceDir = 'C:\\Program Files\\StoClaw\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input).includes('openclaw-plugins\\wecom\\package.json')) {
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
    const result = ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result).toEqual({
      installed: false,
      warning: 'Failed to install bundled WeCom plugin mirror',
    });

    expect(mockCpSync).toHaveBeenCalledTimes(2);
    const [firstSourcePath, firstTargetPath] = mockCpSync.mock.calls[0] as [string, string];
    expect(firstSourcePath.startsWith('\\\\?\\')).toBe(true);
    expect(firstTargetPath.startsWith('\\\\?\\')).toBe(true);

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        pluginDirName: 'wecom',
        pluginLabel: 'WeCom',
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

    const sourceDir = 'C:\\Program Files\\StoClaw\\resources\\openclaw-plugins\\wecom';
    const sourceManifestSuffix = 'openclaw-plugins\\wecom\\openclaw.plugin.json';

    mockExistsSync.mockImplementation((input: string) => String(input).includes(sourceManifestSuffix));
    mockReadFileSync.mockImplementation((input: string) => {
      if (String(input).includes('openclaw-plugins\\wecom\\package.json')) {
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
    const result = ensurePluginInstalled('wecom', [sourceDir], 'WeCom');

    expect(result.installed).toBe(false);
    expect(result.warning).toBe('Failed to install bundled WeCom plugin mirror');

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[plugin] Bundled mirror install failed for WeCom',
      expect.objectContaining({
        sourceDir,
        targetDir: '/home/test/.stoclaw/openclaw/extensions/wecom',
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
  const targetDir = '/home/test/.stoclaw/openclaw/extensions/openclaw-weixin';
  const sharedRuntimeDir = '/home/test/.stoclaw/openclaw/runtime/openclaw';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetOpenClawDir.mockReturnValue('/mock/openclaw');
    mockRealpathSync.mockImplementation((input: string) => input);
  });

  it('treats non-channel plugins as layout-complete', async () => {
    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('sto-workflow-tool', targetDir)).toBe(true);
  });

  it('returns false when openclaw peer package is missing', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('openclaw.plugin.json')) return true;
      if (path.endsWith('/mock/openclaw/package.json')) return true;
      return false;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } }));

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(false);
  });

  it('returns false when materialized peer is missing runtime deps beyond tslog', async () => {
    mockGetOpenClawDir.mockReturnValue('/mock/openclaw.asar');
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      return path.endsWith('openclaw.plugin.json')
        || path.endsWith('/mock/openclaw.asar/package.json')
        || path.endsWith('node_modules/openclaw')
        || path.endsWith(`${sharedRuntimeDir}/package.json`)
        || path.endsWith(`${sharedRuntimeDir}/openclaw.mjs`)
        || path.endsWith(`${sharedRuntimeDir}/dist/plugin-sdk/channel-config-schema.js`)
        || path.endsWith(`${sharedRuntimeDir}/node_modules/tslog/package.json`)
        || path.endsWith('node_modules/zod/package.json');
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('extensions/openclaw-weixin/package.json')) {
        return JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } });
      }
      if (path.endsWith('node_modules/zod/package.json')) {
        return JSON.stringify({ version: '4.4.3' });
      }
      return '{}';
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });
    mockReadlinkSync.mockReturnValue(sharedRuntimeDir);

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(false);
  });

  it('returns false when installed zod major version does not satisfy plugin range', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      return path.endsWith('openclaw.plugin.json')
        || path.endsWith('/mock/openclaw/package.json')
        || path.endsWith('node_modules/openclaw/package.json')
        || path.endsWith('node_modules/openclaw/openclaw.mjs')
        || path.endsWith('node_modules/openclaw/dist/plugin-sdk/channel-config-schema.js')
        || path.endsWith('node_modules/openclaw/node_modules/tslog/package.json')
        || path.endsWith('node_modules/openclaw/node_modules/json5/package.json')
        || path.endsWith('node_modules/openclaw/node_modules/chalk/package.json')
        || path.endsWith('node_modules/zod/package.json');
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('extensions/openclaw-weixin/package.json')) {
        return JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } });
      }
      if (path.endsWith('node_modules/zod/package.json')) {
        return JSON.stringify({ version: '3.25.76' });
      }
      return '{}';
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false, isDirectory: () => true });

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(false);
  });

  it('returns true when shared materialized openclaw runtime and matching deps are present', async () => {
    mockGetOpenClawDir.mockReturnValue('/mock/openclaw.asar');
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      return path.endsWith('openclaw.plugin.json')
        || path.endsWith('/mock/openclaw.asar/package.json')
        || path.endsWith('node_modules/openclaw')
        || path.endsWith(`${sharedRuntimeDir}/package.json`)
        || path.endsWith(`${sharedRuntimeDir}/openclaw.mjs`)
        || path.endsWith(`${sharedRuntimeDir}/dist/plugin-sdk/channel-config-schema.js`)
        || path.endsWith(`${sharedRuntimeDir}/node_modules/tslog/package.json`)
        || path.endsWith(`${sharedRuntimeDir}/node_modules/json5/package.json`)
        || path.endsWith(`${sharedRuntimeDir}/node_modules/chalk/package.json`)
        || path.endsWith('node_modules/zod/package.json');
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('extensions/openclaw-weixin/package.json')) {
        return JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } });
      }
      if (path.endsWith('node_modules/zod/package.json')) {
        return JSON.stringify({ version: '4.4.3' });
      }
      return '{}';
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });
    mockReadlinkSync.mockReturnValue(sharedRuntimeDir);

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(true);
  });

  it('returns true when legacy in-plugin materialized openclaw has full runtime deps', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      return path.endsWith('openclaw.plugin.json')
        || path.endsWith('/mock/openclaw/package.json')
        || path.endsWith('node_modules/openclaw')
        || path.endsWith('node_modules/openclaw/package.json')
        || path.endsWith('node_modules/openclaw/openclaw.mjs')
        || path.endsWith('node_modules/openclaw/dist/plugin-sdk/channel-config-schema.js')
        || path.endsWith('node_modules/openclaw/node_modules/tslog/package.json')
        || path.endsWith('node_modules/openclaw/node_modules/json5/package.json')
        || path.endsWith('node_modules/openclaw/node_modules/chalk/package.json')
        || path.endsWith('node_modules/zod/package.json');
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('extensions/openclaw-weixin/package.json')) {
        return JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } });
      }
      if (path.endsWith('node_modules/zod/package.json')) {
        return JSON.stringify({ version: '4.4.3' });
      }
      return '{}';
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => false, isDirectory: () => true });

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(true);
  });

  it('returns true when dev symlink openclaw package and matching dep versions are present', async () => {
    mockExistsSync.mockImplementation((input: string) => {
      const path = String(input);
      return path.endsWith('openclaw.plugin.json')
        || path.endsWith('/mock/openclaw/package.json')
        || path.endsWith('node_modules/openclaw')
        || path.endsWith('node_modules/zod/package.json');
    });
    mockReadFileSync.mockImplementation((input: string) => {
      const path = String(input);
      if (path.endsWith('extensions/openclaw-weixin/package.json')) {
        return JSON.stringify({ dependencies: { openclaw: '1.0.0', zod: '^4.3.6' } });
      }
      if (path.endsWith('node_modules/zod/package.json')) {
        return JSON.stringify({ version: '4.4.3' });
      }
      return '{}';
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true });
    mockReadlinkSync.mockReturnValue('/mock/openclaw');

    const { channelPluginRuntimeLayoutComplete } = await import('@electron/utils/plugin-install');
    expect(channelPluginRuntimeLayoutComplete('openclaw-weixin', targetDir)).toBe(true);
  });
});
