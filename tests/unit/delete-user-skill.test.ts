import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storeRootRef,
  userCodeRef,
  preinstalledSlugsRef,
  reconcileMock,
} = vi.hoisted(() => ({
  storeRootRef: { current: '' },
  userCodeRef: { current: 'u1205314' as string | null },
  preinstalledSlugsRef: { current: new Set<string>(['sai-cli', 'pdf']) },
  reconcileMock: vi.fn(async () => undefined),
}));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>(
    '../../electron/utils/paths',
  );
  return {
    ...actual,
    getSkillsStoreDir: () => storeRootRef.current,
    getSkillsStoreGlobalDir: () => join(storeRootRef.current, 'global'),
    getSkillsStoreUserSkillsDir: (userCode: string) =>
      join(storeRootRef.current, 'users', userCode, 'skills'),
    getSkillsStoreAgentSkillsDir: (agentId: string) =>
      join(storeRootRef.current, 'agents', agentId, 'skills'),
    getSkillsManifestPath: () => join(storeRootRef.current, 'manifest.json'),
    getOpenClawConfigDir: () => join(storeRootRef.current, 'openclaw'),
  };
});

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../electron/services/user-skill-workspace', () => ({
  getCurrentActiveUserCode: async () => userCodeRef.current,
}));

vi.mock('../../electron/utils/skill-config', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/skill-config')>(
    '../../electron/utils/skill-config',
  );
  return {
    ...actual,
    readPreinstalledManifestSlugs: () => preinstalledSlugsRef.current,
  };
});

vi.mock('../../electron/services/skills/skill-manager', () => ({
  getSkillManager: () => ({
    reconcile: reconcileMock,
  }),
}));

vi.mock('../../electron/services/skills/orphan-skill-import', () => ({
  scheduleOrphanSkillImport: vi.fn(),
}));

describe('deleteUserSkill', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    reconcileMock.mockClear();
    reconcileMock.mockResolvedValue(undefined);
    userCodeRef.current = 'u1205314';
    preinstalledSlugsRef.current = new Set(['sai-cli', 'pdf']);
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-save-user-skill-'));
    storeRootRef.current = tempRoot;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('deletes only the current user copy and reconciles projections', async () => {
    const store = await import('../../electron/services/skills/canonical-store');
    const keys = [
      { slug: 'demo', scope: 'user' as const, userCode: 'u1205314' },
      { slug: 'demo', scope: 'user' as const, userCode: 'other' },
      { slug: 'demo', scope: 'global' as const },
    ];
    for (const key of keys) {
      const dir = store.resolvePackageDir(key);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), 'demo');
      await store.upsertSkillEntry({ ...key, version: '1', source: 'local', enabled: false });
    }
    const { deleteUserSkill } = await import('../../electron/services/skills/delete-user-skill');
    await expect(deleteUserSkill({ slug: 'demo' })).resolves.toMatchObject({ ok: true, slug: 'demo' });
    expect(existsSync(store.resolvePackageDir(keys[0]))).toBe(false);
    expect(await store.getSkillEntry(keys[0])).toBeNull();
    for (const key of keys.slice(1)) {
      expect(existsSync(store.resolvePackageDir(key))).toBe(true);
      expect(await store.getSkillEntry(key)).not.toBeNull();
    }
    expect(reconcileMock).toHaveBeenCalledWith({ userCode: 'u1205314' });
  });

  it.each(['../demo', '/tmp/demo', 'Demo', '', 'demo/name'])('rejects invalid destructive targets: %s', async (slug) => {
    const { deleteUserSkill } = await import('../../electron/services/skills/delete-user-skill');
    await expect(deleteUserSkill({ slug })).rejects.toMatchObject({ code: 'INVALID_SLUG' });
    expect(reconcileMock).not.toHaveBeenCalled();
  });

  it('rejects missing, protected, and logged-out targets', async () => {
    const { deleteUserSkill } = await import('../../electron/services/skills/delete-user-skill');
    await expect(deleteUserSkill({ slug: 'missing' })).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
    await expect(deleteUserSkill({ slug: 'pdf' })).rejects.toMatchObject({ code: 'PREINSTALL_PROTECTED' });
    userCodeRef.current = null;
    await expect(deleteUserSkill({ slug: 'demo' })).rejects.toMatchObject({ code: 'NOT_LOGGED_IN' });
    expect(reconcileMock).not.toHaveBeenCalled();
  });
});
