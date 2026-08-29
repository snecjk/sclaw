import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { storeRootRef } = vi.hoisted(() => ({
  storeRootRef: { current: '' },
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

describe('canonical skill store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-skills-store-'));
    storeRootRef.current = tempRoot;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes and reads a user-scoped manifest entry', async () => {
    const store = await import('../../electron/services/skills/canonical-store');
    const packageDir = join(tempRoot, 'users', 'u1', 'skills', 'pdf');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'SKILL.md'), '---\nname: pdf\n---\n', 'utf-8');

    await store.upsertSkillEntry({
      slug: 'pdf',
      scope: 'user',
      userCode: 'u1',
      version: '1.2.0',
      source: 'sto-marketplace',
      name: 'PDF',
      enabled: true,
    });

    const entry = await store.getSkillEntry({ slug: 'pdf', scope: 'user', userCode: 'u1' });
    expect(entry).toMatchObject({
      slug: 'pdf',
      scope: 'user',
      userCode: 'u1',
      version: '1.2.0',
      enabled: true,
    });
    expect(store.resolvePackageDir(entry!)).toBe(packageDir);
  });

  it('lists desired packages with agent overriding global on slug collision', async () => {
    const store = await import('../../electron/services/skills/canonical-store');

    const globalDir = join(tempRoot, 'global', 'pdf');
    const agentDir = join(tempRoot, 'agents', 'main', 'skills', 'pdf');
    await mkdir(globalDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(globalDir, 'SKILL.md'), '---\nname: pdf\n---\n', 'utf-8');
    await writeFile(join(agentDir, 'SKILL.md'), '---\nname: pdf\n---\n', 'utf-8');

    await store.upsertSkillEntry({
      slug: 'pdf',
      scope: 'global',
      version: '1.0.0',
      source: 'preinstalled',
      enabled: true,
    });
    await store.upsertSkillEntry({
      slug: 'pdf',
      scope: 'agent',
      agentId: 'main',
      version: '2.0.0',
      source: 'sto-marketplace',
      enabled: true,
    });

    const desired = await store.listDesiredPackages({ userCode: 'u1', agentId: 'main' });
    expect(desired).toHaveLength(1);
    expect(desired[0]).toMatchObject({
      slug: 'pdf',
      scope: 'agent',
      version: '2.0.0',
      sourceDir: agentDir,
    });
  });

  it('fills missing manifest metadata from SKILL.md frontmatter', async () => {
    const store = await import('../../electron/services/skills/canonical-store');
    const skillDir = join(tempRoot, 'users', 'u1', 'skills', 'customer-anomaly-daily-report');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: customer-anomaly-daily-report',
        'title: 网点客户异常监控',
        'description: 客户异常监控生成技能。用户要求异常监控时触发。',
        'author: SAI',
        '---',
        '',
        '# 客户异常监控',
      ].join('\n'),
      'utf-8',
    );
    await store.upsertSkillEntry({
      slug: 'customer-anomaly-daily-report',
      scope: 'user',
      userCode: 'u1',
      version: '1.0.0',
      source: 'local',
      enabled: true,
    });

    const desired = await store.listDesiredPackages({ userCode: 'u1', agentId: 'main' });

    expect(desired[0]).toMatchObject({
      slug: 'customer-anomaly-daily-report',
      name: '网点客户异常监控',
      description: '客户异常监控生成技能。用户要求异常监控时触发。',
      author: 'SAI',
    });
  });

  it('falls back to legacy lock.json when manifest is missing', async () => {
    const store = await import('../../electron/services/skills/canonical-store');
    const openclawDir = join(tempRoot, 'openclaw');
    await mkdir(join(openclawDir, '.clawhub'), { recursive: true });
    await writeFile(
      join(openclawDir, '.clawhub', 'lock.json'),
      JSON.stringify({
        skills: {
          pdf: {
            version: '3.1.0',
            source: 'sto-marketplace',
            name: 'PDF Tools',
          },
        },
      }),
      'utf-8',
    );

    const fallback = await store.readLegacyLockFallback('pdf');
    expect(fallback).toMatchObject({
      version: '3.1.0',
      source: 'sto-marketplace',
      name: 'PDF Tools',
    });
  });

  it('removes a skill entry from the manifest', async () => {
    const store = await import('../../electron/services/skills/canonical-store');
    await store.upsertSkillEntry({
      slug: 'pdf',
      scope: 'global',
      version: '1.0.0',
      source: 'preinstalled',
      enabled: true,
    });
    await store.removeSkillEntry({ slug: 'pdf', scope: 'global' });
    const entry = await store.getSkillEntry({ slug: 'pdf', scope: 'global' });
    expect(entry).toBeNull();

    const raw = await readFile(join(tempRoot, 'manifest.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { global?: Record<string, unknown> };
    expect(parsed.global?.pdf).toBeUndefined();
  });
});
