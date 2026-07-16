import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/stoclaw-ws-migrate-${suffix}`,
    testUserData: `/tmp/stoclaw-ws-migrate-user-data-${suffix}`,
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

function writeOpenClawJson(config: unknown): void {
  const configDir = join(testHome, '.stoclaw', 'openclaw');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

function readOpenClawJson(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(testHome, '.stoclaw', 'openclaw', 'openclaw.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('ensureWorkspaceLayoutMigrated', () => {
  beforeEach(() => {
    vi.resetModules();
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
    mkdirSync(testHome, { recursive: true });
  });

  afterEach(() => {
    vi.resetModules();
    if (existsSync(testHome)) {
      rmSync(testHome, { recursive: true, force: true });
    }
  });

  it('migrates legacy config paths and renames workspace directories when safe', async () => {
    const configDir = join(testHome, '.stoclaw', 'openclaw');
    const legacyMain = join(configDir, 'workspace');
    const legacyResearch = join(configDir, 'workspace-research');
    const nextMain = join(testHome, '.stoclaw', 'workspace');
    const nextResearch = join(testHome, '.stoclaw', 'workspace-research');
    mkdirSync(legacyMain, { recursive: true });
    mkdirSync(legacyResearch, { recursive: true });
    writeFileSync(join(legacyMain, 'AGENTS.md'), '# main', 'utf8');

    writeOpenClawJson({
      agents: {
        defaults: { workspace: '~/.stoclaw/openclaw/workspace' },
        list: [
          { id: 'main', workspace: '~/.stoclaw/openclaw/workspace' },
          { id: 'research', workspace: '~/.stoclaw/openclaw/workspace-research' },
        ],
      },
    });

    const { ensureWorkspaceLayoutMigrated } = await import('../../electron/utils/workspace-migration');
    await ensureWorkspaceLayoutMigrated();

    const updated = readOpenClawJson() as {
      agents: {
        defaults: { workspace: string };
        list: Array<{ id: string; workspace: string }>;
      };
    };

    expect(updated.agents.defaults.workspace).toBe('~/.stoclaw/workspace');
    expect(updated.agents.list.map((entry) => entry.workspace)).toEqual([
      '~/.stoclaw/workspace',
      '~/.stoclaw/workspace-research',
    ]);
    expect(existsSync(nextMain)).toBe(true);
    expect(existsSync(nextResearch)).toBe(true);
    expect(existsSync(legacyMain)).toBe(false);
    expect(existsSync(legacyResearch)).toBe(false);
  });

  it('skips directory rename when the new workspace already exists', async () => {
    const configDir = join(testHome, '.stoclaw', 'openclaw');
    const legacyMain = join(configDir, 'workspace');
    const nextMain = join(testHome, '.stoclaw', 'workspace');
    mkdirSync(legacyMain, { recursive: true });
    mkdirSync(nextMain, { recursive: true });
    writeFileSync(join(legacyMain, 'legacy.txt'), 'legacy', 'utf8');
    writeFileSync(join(nextMain, 'current.txt'), 'current', 'utf8');

    writeOpenClawJson({
      agents: {
        defaults: { workspace: '~/.stoclaw/openclaw/workspace' },
        list: [{ id: 'main', workspace: '~/.stoclaw/openclaw/workspace' }],
      },
    });

    const { ensureWorkspaceLayoutMigrated } = await import('../../electron/utils/workspace-migration');
    await ensureWorkspaceLayoutMigrated();

    expect(existsSync(legacyMain)).toBe(true);
    expect(existsSync(nextMain)).toBe(true);
    expect(existsSync(join(legacyMain, 'legacy.txt'))).toBe(true);
    expect(existsSync(join(nextMain, 'current.txt'))).toBe(true);
  });
});
