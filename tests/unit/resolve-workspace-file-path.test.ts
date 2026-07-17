import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function mockPaths(opts: { home: string; configDir: string; legacyRoot: string; defaultRoot: string }): void {
  vi.doMock('../../electron/utils/paths', () => ({
    getOpenClawConfigDir: () => opts.configDir,
    getLegacyOpenClawWorkspaceRoot: () => opts.legacyRoot,
    getDefaultAgentWorkspacePath: () => opts.defaultRoot,
    getLegacyDefaultAgentWorkspacePath: () => join(opts.configDir, 'workspace'),
    getStoClawHomeDir: () => join(opts.home, '.stoclaw'),
    expandPath: (p: string) => p.replace(/^~/, opts.home),
  }));
}

describe('resolveWorkspaceFilePath deep output search', () => {
  let tempRoot = '';

  afterEach(() => {
    vi.doUnmock('../../electron/utils/paths');
    vi.resetModules();
    if (tempRoot && existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('finds basename nested under .claw-output when hint path is wrong', async () => {
    tempRoot = join(tmpdir(), `stoclaw-artifact-${Date.now()}`);
    const home = join(tempRoot, 'home');
    const configDir = join(home, '.stoclaw', 'openclaw');
    const workspace = join(home, '.stoclaw', 'workspace');
    const nested = join(workspace, '.claw-output', 'stock-analysis');
    mkdirSync(nested, { recursive: true });
    const realFile = join(nested, 'weekly.html');
    writeFileSync(realFile, '<html></html>', 'utf8');

    mockPaths({ home, configDir, legacyRoot: join(home, '.openclaw', 'workspace'), defaultRoot: workspace });

    vi.resetModules();
    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');
    const wrongAbs = join(workspace, '.claw-output', 'weekly.html');
    expect(resolveWorkspaceFilePath(wrongAbs)).toBe(realFile);
    expect(resolveWorkspaceFilePath('weekly.html')).toBe(realFile);
  });

  it('prefers legacy .openclaw path when file exists only there', async () => {
    tempRoot = join(tmpdir(), `stoclaw-legacy-${Date.now()}`);
    const home = join(tempRoot, 'home');
    const legacyRoot = join(home, '.openclaw', 'workspace');
    const legacyFile = join(legacyRoot, 'output', '总部结算对账分析_日_20260629_1549.html');
    mkdirSync(join(legacyRoot, 'output'), { recursive: true });
    writeFileSync(legacyFile, '<html>legacy</html>', 'utf8');

    const configDir = join(home, '.stoclaw', 'openclaw');
    const defaultRoot = join(home, '.stoclaw', 'workspace');
    mkdirSync(defaultRoot, { recursive: true });

    mockPaths({ home, configDir, legacyRoot, defaultRoot });
    vi.doMock('node:os', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:os')>();
      return { ...actual, homedir: () => home };
    });

    vi.resetModules();
    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');

    const legacyHint = legacyFile.replace(/\\/g, '/');
    expect(resolveWorkspaceFilePath(legacyHint)).toBe(legacyFile);

    const migratedHint = legacyHint.replace('/.openclaw/workspace', '/.stoclaw/workspace');
    expect(resolveWorkspaceFilePath(migratedHint)).toBe(legacyFile);
  });

  it('falls back to migrated .stoclaw path when legacy path is missing', async () => {
    tempRoot = join(tmpdir(), `stoclaw-migrated-${Date.now()}`);
    const home = join(tempRoot, 'home');
    const migratedRoot = join(home, '.stoclaw', 'workspace');
    const migratedFile = join(migratedRoot, '.claw-output', 'report.html');
    mkdirSync(join(migratedRoot, '.claw-output'), { recursive: true });
    writeFileSync(migratedFile, '<html>migrated</html>', 'utf8');

    const configDir = join(home, '.stoclaw', 'openclaw');

    mockPaths({
      home,
      configDir,
      legacyRoot: join(home, '.openclaw', 'workspace'),
      defaultRoot: migratedRoot,
    });
    vi.doMock('node:os', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:os')>();
      return { ...actual, homedir: () => home };
    });

    vi.resetModules();
    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');

    const legacyHint = join(home, '.openclaw', 'workspace', '.claw-output', 'report.html').replace(/\\/g, '/');
    expect(resolveWorkspaceFilePath(legacyHint)).toBe(migratedFile);
  });
});
