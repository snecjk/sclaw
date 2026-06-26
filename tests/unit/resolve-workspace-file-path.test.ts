import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolveWorkspaceFilePath deep output search', () => {
  let tempRoot = '';

  afterEach(() => {
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
});
