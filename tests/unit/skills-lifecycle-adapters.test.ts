import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roots = vi.hoisted(() => ({
  store: '',
  openclaw: '',
  claude: '',
}));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>(
    '../../electron/utils/paths',
  );
  return {
    ...actual,
    getSkillsStoreDir: () => roots.store,
    getSkillsStoreGlobalDir: () => join(roots.store, 'global'),
    getSkillsStoreUserSkillsDir: (userCode: string) => join(roots.store, 'users', userCode, 'skills'),
    getSkillsStoreAgentSkillsDir: (agentId: string) => join(roots.store, 'agents', agentId, 'skills'),
    getSkillsManifestPath: () => join(roots.store, 'manifest.json'),
    getSkillsStoreMigratedMarkerPath: () => join(roots.store, '.migrated'),
    getOpenClawConfigDir: () => roots.openclaw,
    getOpenClawSkillsDir: () => join(roots.openclaw, 'skills'),
    getOpenClawAgentSkillsDir: (agentId: string) =>
      join(roots.openclaw, 'agents', agentId, 'agent', 'skills'),
    getClaudeConfigDir: () => roots.claude,
    getClaudeSkillsDir: () => join(roots.claude, 'skills'),
    getClawXConfigDir: () => join(roots.store, '..'),
  };
});

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../electron/utils/skill-config', () => ({
  setSkillsEnabled: vi.fn(async () => undefined),
  updateSkillConfig: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../electron/services/project-agent-service', () => ({
  syncBaseAgentSkillInstall: vi.fn(async () => undefined),
  syncBaseAgentSkillUninstall: vi.fn(async () => undefined),
}));

vi.mock('../../electron/services/user-skill-workspace', () => ({
  getCurrentActiveUserCode: vi.fn(async () => 'u1'),
}));

async function writeSkill(dir: string, name = 'demo'): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`,
    'utf-8',
  );
}

describe('skill lifecycle adapters + manager', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-skill-lifecycle-'));
    roots.store = join(tempRoot, 'skills-store');
    roots.openclaw = join(tempRoot, 'openclaw');
    roots.claude = join(tempRoot, '.claude');
    await mkdir(roots.store, { recursive: true });
    await mkdir(join(roots.openclaw, 'skills'), { recursive: true });
    await mkdir(join(roots.claude, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('Claude reconcile is idempotent and skips unmanaged conflicts', async () => {
    const { ClaudeSkillAdapter } = await import(
      '../../electron/services/skills/adapters/claude-skill-adapter'
    );
    const sourceDir = join(roots.store, 'global', 'pdf');
    await writeSkill(sourceDir, 'pdf');

    // Unmanaged conflict for the same slug
    const conflictDir = join(roots.claude, 'skills', 'pdf');
    await writeSkill(conflictDir, 'pdf');

    const adapter = new ClaudeSkillAdapter();
    const desired = [{
      slug: 'pdf',
      sourceDir,
      version: '1.0.0',
      enabled: true,
      scope: 'global' as const,
    }];

    const first = await adapter.reconcile(desired, { userCode: 'u1' });
    expect(first.mirrored).toEqual([]);
    expect(first.skippedConflicts).toContain('pdf');

    // Convert to managed by installing once after removing unmanaged dir
    await rm(conflictDir, { recursive: true, force: true });
    const installed = await adapter.reconcile(desired, { userCode: 'u1' });
    expect(installed.mirrored).toContain('pdf');

    const before = await stat(join(roots.claude, 'skills', 'pdf', 'SKILL.md'));
    const second = await adapter.reconcile(desired, { userCode: 'u1' });
    expect(second.mirrored).toEqual([]);
    const after = await stat(join(roots.claude, 'skills', 'pdf', 'SKILL.md'));
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('keeps canonical install when an adapter projection fails', async () => {
    const { setEngineSkillAdapters } = await import(
      '../../electron/services/skills/adapters/engine-skill-adapter'
    );
    const { upsertSkillEntry, getSkillEntry, resolvePackageDir } = await import(
      '../../electron/services/skills/canonical-store'
    );
    const { resetSkillManagerForTests, getSkillManager } = await import(
      '../../electron/services/skills/skill-manager'
    );

    resetSkillManagerForTests();

    const failingAdapter = {
      id: 'claude' as const,
      applyInstall: vi.fn(async () => {
        throw new Error('claude projection boom');
      }),
      applyUninstall: vi.fn(async () => undefined),
      applyEnabled: vi.fn(async () => undefined),
      reconcile: vi.fn(async () => ({ mirrored: [], removed: [], skippedConflicts: [] })),
    };
    const okAdapter = {
      id: 'openclaw' as const,
      applyInstall: vi.fn(async () => undefined),
      applyUninstall: vi.fn(async () => undefined),
      applyEnabled: vi.fn(async () => undefined),
      reconcile: vi.fn(async () => ({ mirrored: [], removed: [], skippedConflicts: [] })),
    };
    setEngineSkillAdapters([okAdapter, failingAdapter]);

    const sourceDir = join(roots.store, 'users', 'u1', 'skills', 'pdf');
    await writeSkill(sourceDir, 'pdf');
    await upsertSkillEntry({
      slug: 'pdf',
      scope: 'user',
      userCode: 'u1',
      version: '1.0.0',
      source: 'sto-marketplace',
      enabled: true,
    });

    // Simulate fan-out install path via setEnabled (uses applyEnabled + applyInstall)
    const manager = getSkillManager();
    await manager.setEnabled('pdf', true);

    const entry = await getSkillEntry({ slug: 'pdf', scope: 'user', userCode: 'u1' });
    expect(entry).not.toBeNull();
    expect(existsSync(join(resolvePackageDir(entry!), 'SKILL.md'))).toBe(true);
    expect(failingAdapter.applyInstall).toHaveBeenCalled();
    expect(okAdapter.applyEnabled).toHaveBeenCalled();
  });

  it('migrates legacy openclaw layout into skills-store and is idempotent', async () => {
    const openclawSkills = join(roots.openclaw, 'skills', 'pdf');
    await writeSkill(openclawSkills, 'pdf');
    await mkdir(join(roots.openclaw, '.clawhub'), { recursive: true });
    await writeFile(
      join(roots.openclaw, '.clawhub', 'lock.json'),
      JSON.stringify({
        skills: {
          pdf: { version: '2.0.0', source: 'sto-marketplace', name: 'PDF' },
        },
      }),
      'utf-8',
    );

    const { migrateSkillsStoreIfNeeded, isSkillsStoreMigrated } = await import(
      '../../electron/services/skills/migration'
    );
    const first = await migrateSkillsStoreIfNeeded();
    expect(first.migrated).toBe(true);
    expect(isSkillsStoreMigrated()).toBe(true);
    expect(existsSync(join(roots.store, 'global', 'pdf', 'SKILL.md'))).toBe(true);

    const manifest = JSON.parse(await readFile(join(roots.store, 'manifest.json'), 'utf-8')) as {
      global: Record<string, { version?: string }>;
    };
    expect(manifest.global.pdf.version).toBe('2.0.0');

    const second = await migrateSkillsStoreIfNeeded();
    expect(second.migrated).toBe(false);
  });

  it('uninstall removes both user and global marketplace copies of the same slug', async () => {
    const { upsertSkillEntry, getSkillEntry, resolvePackageDir } = await import(
      '../../electron/services/skills/canonical-store'
    );
    const { setEngineSkillAdapters } = await import(
      '../../electron/services/skills/adapters/engine-skill-adapter'
    );
    const { getSkillManager } = await import('../../electron/services/skills/skill-manager');

    setEngineSkillAdapters([
      {
        id: 'openclaw',
        applyInstall: vi.fn(async () => undefined),
        applyUninstall: vi.fn(async () => undefined),
        applyEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => ({ mirrored: [], removed: [], skippedConflicts: [] })),
      },
      {
        id: 'claude',
        applyInstall: vi.fn(async () => undefined),
        applyUninstall: vi.fn(async () => undefined),
        applyEnabled: vi.fn(async () => undefined),
        reconcile: vi.fn(async () => ({ mirrored: [], removed: [], skippedConflicts: [] })),
      },
    ]);

    const globalKey = { slug: 'sitekeeper-odps-sql', scope: 'global' as const };
    const userKey = { slug: 'sitekeeper-odps-sql', scope: 'user' as const, userCode: 'u1' };
    await writeSkill(resolvePackageDir(globalKey), 'sitekeeper-odps-sql');
    await writeSkill(resolvePackageDir(userKey), 'sitekeeper-odps-sql');
    await upsertSkillEntry({
      ...globalKey,
      version: '1.0.0',
      source: 'sto-marketplace',
      enabled: true,
    });
    await upsertSkillEntry({
      ...userKey,
      version: '1.0.0',
      source: 'sto-marketplace',
      enabled: true,
    });

    await getSkillManager().uninstall({ slug: 'sitekeeper-odps-sql' });

    expect(await getSkillEntry(userKey)).toBeNull();
    expect(await getSkillEntry(globalKey)).toBeNull();
    expect(existsSync(join(resolvePackageDir(userKey), 'SKILL.md'))).toBe(false);
    expect(existsSync(join(resolvePackageDir(globalKey), 'SKILL.md'))).toBe(false);
  });
});
