import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storeRootRef,
  openclawSkillsRef,
  workspaceSkillsRef,
  userCodeRef,
  preinstalledSlugsRef,
  installFromLocalDirMock,
} = vi.hoisted(() => ({
  storeRootRef: { current: '' },
  openclawSkillsRef: { current: '' },
  workspaceSkillsRef: { current: '' },
  userCodeRef: { current: 'u1' as string | null },
  preinstalledSlugsRef: { current: new Set<string>(['sai-cli']) },
  installFromLocalDirMock: vi.fn(async () => undefined),
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
    getSkillsManifestPath: () => join(storeRootRef.current, 'manifest.json'),
    getOpenClawConfigDir: () => join(storeRootRef.current, 'openclaw'),
    getOpenClawSkillsDir: () => openclawSkillsRef.current,
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

vi.mock('../../electron/utils/agent-config', () => ({
  getAgentWorkspacePath: async () => join(workspaceSkillsRef.current, '..'),
}));

vi.mock('../../electron/services/skills/skill-manager', () => ({
  getSkillManager: () => ({
    installFromLocalDir: installFromLocalDirMock,
  }),
}));

describe('orphan-skill-import', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    installFromLocalDirMock.mockClear();
    userCodeRef.current = 'u1';
    preinstalledSlugsRef.current = new Set(['sai-cli']);
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-orphan-import-'));
    storeRootRef.current = tempRoot;
    openclawSkillsRef.current = join(tempRoot, 'openclaw', 'skills');
    workspaceSkillsRef.current = join(tempRoot, 'workspace', 'skills');
    await mkdir(openclawSkillsRef.current, { recursive: true });
    await mkdir(workspaceSkillsRef.current, { recursive: true });

    const { _resetOrphanSkillImportForTests } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    _resetOrphanSkillImportForTests();
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('imports unmanaged openclaw skill missing from skills-store', async () => {
    const dir = join(openclawSkillsRef.current, 'orphan-demo');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: orphan-demo\ndescription: orphan\n---\n\n# Orphan\n',
      'utf8',
    );

    const { runOrphanSkillImport } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    const result = await runOrphanSkillImport('test');
    expect(result.imported).toContain('orphan-demo');
    expect(installFromLocalDirMock).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'orphan-demo',
        scope: 'user',
        source: 'local',
        sourceDir: dir,
      }),
    );
  });

  it('skips managed openclaw projections', async () => {
    const dir = join(openclawSkillsRef.current, 'managed-demo');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: managed-demo\ndescription: managed\n---\n\n# M\n',
      'utf8',
    );
    await writeFile(
      join(dir, '.stoclaw-openclaw-skill-projection.json'),
      JSON.stringify({ slug: 'managed-demo' }),
      'utf8',
    );

    const { runOrphanSkillImport } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    const result = await runOrphanSkillImport('test');
    expect(result.imported).not.toContain('managed-demo');
    expect(installFromLocalDirMock).not.toHaveBeenCalled();
  });

  it('skips preinstall whitelist slugs', async () => {
    const dir = join(openclawSkillsRef.current, 'sai-cli');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: sai-cli\ndescription: cli\n---\n\n# cli\n',
      'utf8',
    );

    const { runOrphanSkillImport } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    const result = await runOrphanSkillImport('test');
    expect(result.imported).not.toContain('sai-cli');
    expect(installFromLocalDirMock).not.toHaveBeenCalled();
  });

  it('skips when user skills-store entry already exists', async () => {
    const storeDir = join(tempRoot, 'users', 'u1', 'skills', 'already');
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, 'SKILL.md'), '---\nname: already\ndescription: x\n---\n', 'utf8');
    const store = await import('../../electron/services/skills/canonical-store');
    await store.upsertSkillEntry({
      slug: 'already',
      scope: 'user',
      userCode: 'u1',
      version: '1.0.0',
      source: 'local',
      enabled: true,
    });

    const dir = join(openclawSkillsRef.current, 'already');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: already\ndescription: orphan copy\n---\n\n# x\n',
      'utf8',
    );

    const { runOrphanSkillImport } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    const result = await runOrphanSkillImport('test');
    expect(result.imported).not.toContain('already');
    expect(installFromLocalDirMock).not.toHaveBeenCalled();
  });

  it('imports unmanaged workspace skills', async () => {
    const dir = join(workspaceSkillsRef.current, 'ws-skill');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      '---\nname: ws-skill\ndescription: from workspace\n---\n\n# WS\n',
      'utf8',
    );

    const { runOrphanSkillImport } = await import(
      '../../electron/services/skills/orphan-skill-import'
    );
    const result = await runOrphanSkillImport('test');
    expect(result.imported).toContain('ws-skill');
  });
});
