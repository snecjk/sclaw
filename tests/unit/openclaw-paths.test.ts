import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RESOURCES = 'C:/Program Files/StoClaw/resources';
const originalResourcesPath = process.resourcesPath;

const { mockExistsSync, mockIsPackagedGetter } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getAppPath: () => '/app',
    getPath: () => '/tmp',
  },
}));

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('OpenClaw packaged paths (ASAR)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: RESOURCES,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('prefers openclaw.asar for getOpenClawDir()', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      const normalized = normalizePath(p);
      if (normalized.endsWith('/openclaw.asar')) return true;
      if (normalized.endsWith('/openclaw.asar/openclaw.mjs')) return true;
      if (normalized.endsWith('/openclaw.asar/node_modules')) return true;
      return false;
    });

    const { getOpenClawDir, getOpenClawEntryPath, getOpenClawProcessCwd, getOpenClawNodeModulesPath } = await import('@electron/utils/paths');
    expect(getOpenClawDir()).toBe(join(RESOURCES, 'openclaw.asar'));
    expect(getOpenClawEntryPath()).toBe(join(RESOURCES, 'openclaw.asar', 'openclaw.mjs'));
    expect(getOpenClawProcessCwd()).toBe(RESOURCES);
    expect(getOpenClawNodeModulesPath()).toContain(join(RESOURCES, 'openclaw.asar', 'node_modules'));
  });

  it('prepends openclaw.asar.unpacked node_modules to NODE_PATH when present', async () => {
    const unpackedNm = join(RESOURCES, 'openclaw.asar.unpacked', 'node_modules');
    mockExistsSync.mockImplementation((p: string) => {
      const normalized = normalizePath(p);
      if (normalized.endsWith('/openclaw.asar')) return true;
      if (normalized.endsWith('/openclaw.asar/openclaw.mjs')) return true;
      if (normalized === normalizePath(unpackedNm)) return true;
      if (normalized.endsWith('/openclaw.asar/node_modules')) return true;
      return false;
    });

    const { getOpenClawNodeModulesPath } = await import('@electron/utils/paths');
    const nodePath = getOpenClawNodeModulesPath();
    expect(nodePath.startsWith(unpackedNm)).toBe(true);
    expect(nodePath).toContain(join(RESOURCES, 'openclaw.asar', 'node_modules'));
  });

  it('falls back to legacy openclaw/ directory when asar is absent', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      const normalized = normalizePath(p);
      if (normalized.endsWith('/openclaw/package.json')) return true;
      if (normalized.endsWith('/openclaw/openclaw.mjs')) return true;
      return false;
    });

    const { getOpenClawDir, getOpenClawProcessCwd } = await import('@electron/utils/paths');
    expect(getOpenClawDir()).toBe(join(RESOURCES, 'openclaw'));
    expect(getOpenClawProcessCwd()).toBe(join(RESOURCES, 'openclaw'));
  });

  it('includes openclaw-plugins.asar in bundled plugin candidates', async () => {
    mockExistsSync.mockReturnValue(false);
    const { getBundledPluginSourceCandidates } = await import('@electron/utils/paths');
    expect(getBundledPluginSourceCandidates('openclaw-weixin')).toEqual([
      join(RESOURCES, 'openclaw-plugins.asar', 'openclaw-weixin'),
      join(RESOURCES, 'openclaw-plugins.asar.unpacked', 'openclaw-weixin'),
      join(RESOURCES, 'openclaw-plugins', 'openclaw-weixin'),
      join(RESOURCES, 'app.asar.unpacked', 'openclaw-plugins', 'openclaw-weixin'),
    ]);
  });
});
