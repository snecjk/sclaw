import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
    const configDir = join(tempRoot, 'openclaw');
    const workspace = join(configDir, 'workspace');
    const nested = join(workspace, '.claw-output', 'stock-analysis');
    mkdirSync(nested, { recursive: true });
    const realFile = join(nested, 'weekly.html');
    writeFileSync(realFile, '<html></html>', 'utf8');

    vi.doMock('../../electron/utils/paths', () => ({
      getOpenClawConfigDir: () => configDir,
      getLegacyOpenClawWorkspaceRoot: () => join(configDir, 'workspace'),
      expandPath: (p: string) => p.replace(/^~/, tempRoot),
    }));

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
    mkdirSync(join(configDir, 'workspace'), { recursive: true });

    vi.doMock('../../electron/utils/paths', () => ({
      getOpenClawConfigDir: () => configDir,
      getLegacyOpenClawWorkspaceRoot: () => legacyRoot,
      expandPath: (p: string) => p.replace(/^~/, home),
    }));
    vi.doMock('node:os', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:os')>();
      return { ...actual, homedir: () => home };
    });

    vi.resetModules();
    const { resolveWorkspaceFilePath } = await import('../../electron/utils/artifact-path');

    const legacyHint = legacyFile.replace(/\\/g, '/');
    expect(resolveWorkspaceFilePath(legacyHint)).toBe(legacyFile);

    const migratedHint = legacyHint.replace('/.openclaw/workspace', '/.stoclaw/openclaw/workspace');
    expect(resolveWorkspaceFilePath(migratedHint)).toBe(legacyFile);
  });

  it('falls back to migrated .stoclaw path when legacy path is missing', async () => {
    tempRoot = join(tmpdir(), `stoclaw-migrated-${Date.now()}`);
    const home = join(tempRoot, 'home');
    const migratedRoot = join(home, '.stoclaw', 'openclaw', 'workspace');
    const migratedFile = join(migratedRoot, '.claw-output', 'report.html');
    mkdirSync(join(migratedRoot, '.claw-output'), { recursive: true });
    writeFileSync(migratedFile, '<html>migrated</html>', 'utf8');

    const configDir = join(home, '.stoclaw', 'openclaw');

    vi.doMock('../../electron/utils/paths', () => ({
      getOpenClawConfigDir: () => configDir,
      getLegacyOpenClawWorkspaceRoot: () => join(home, '.openclaw', 'workspace'),
      expandPath: (p: string) => p.replace(/^~/, home),
    }));
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
