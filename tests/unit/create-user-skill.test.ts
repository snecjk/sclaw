import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveUserSkillError } from '../../electron/services/skills/create-user-skill';

const {
  storeRootRef,
  userCodeRef,
  preinstalledSlugsRef,
  installFromLocalDirMock,
} = vi.hoisted(() => ({
  storeRootRef: { current: '' },
  userCodeRef: { current: 'u1205314' as string | null },
  preinstalledSlugsRef: { current: new Set<string>(['sai-cli', 'pdf']) },
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
    installFromLocalDir: installFromLocalDirMock,
  }),
}));

vi.mock('../../electron/services/skills/orphan-skill-import', () => ({
  scheduleOrphanSkillImport: vi.fn(),
}));

describe('saveUserSkill / normalizeSkillSlug', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    installFromLocalDirMock.mockClear();
    installFromLocalDirMock.mockResolvedValue(undefined);
    userCodeRef.current = 'u1205314';
    preinstalledSlugsRef.current = new Set(['sai-cli', 'pdf']);
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-save-user-skill-'));
    storeRootRef.current = tempRoot;
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('normalizeSkillSlug lowercases and strips invalid chars', async () => {
    const { normalizeSkillSlug } = await import('../../electron/services/skills/create-user-skill');
    expect(normalizeSkillSlug('Hello World')).toBe('hello-world');
    expect(normalizeSkillSlug('  Foo__Bar!!  ')).toBe('foo-bar');
  });

  it('rejects invalid slug', async () => {
    const { normalizeSkillSlug, SaveUserSkillError } = await import(
      '../../electron/services/skills/create-user-skill'
    );
    expect(() => normalizeSkillSlug('---')).toThrow(SaveUserSkillError);
  });

  it('returns NOT_LOGGED_IN when no userCode', async () => {
    userCodeRef.current = null;
    const { saveUserSkill } = await import(
      '../../electron/services/skills/create-user-skill'
    );
    await expect(
      saveUserSkill({
        slug: 'demo-skill',
        skillMd: '---\nname: demo-skill\ndescription: demo\n---\n\n# Demo\n',
      }),
    ).rejects.toMatchObject({ code: 'NOT_LOGGED_IN' } satisfies Partial<SaveUserSkillError>);
  });

  it('rejects preinstalled whitelist slug', async () => {
    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    await expect(
      saveUserSkill({
        slug: 'sai-cli',
        skillMd: '---\nname: sai-cli\ndescription: hack\n---\n\n# x\n',
      }),
    ).rejects.toMatchObject({ code: 'PREINSTALL_PROTECTED' });
  });

  it('rejects missing frontmatter description', async () => {
    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    await expect(
      saveUserSkill({
        slug: 'demo-skill',
        skillMd: '---\nname: demo-skill\n---\n\n# Demo\n',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_SKILL_MD' });
  });

  it('stages SKILL.md + assets and calls installFromLocalDir with user scope', async () => {
    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    const result = await saveUserSkill({
      slug: 'demo-skill',
      skillMd: '---\nname: demo-skill\ndescription: A demo skill\nversion: 1.2.0\n---\n\n# Demo\n',
      assets: [{ path: 'notes.txt', content: 'hello' }],
    });

    expect(result).toMatchObject({
      ok: true,
      slug: 'demo-skill',
      scope: 'user',
      userCode: 'u1205314',
      source: 'local',
    });
    expect(result.storePath).toContain(join('users', 'u1205314', 'skills', 'demo-skill'));
    expect(installFromLocalDirMock).toHaveBeenCalledTimes(1);
    const call = installFromLocalDirMock.mock.calls[0]![0] as {
      slug: string;
      scope: string;
      source: string;
      sourceDir: string;
      version: string;
    };
    expect(call).toMatchObject({
      slug: 'demo-skill',
      scope: 'user',
      source: 'local',
      version: '1.2.0',
    });
    expect(existsSync(join(call.sourceDir, 'SKILL.md'))).toBe(false); // cleaned in finally
  });

  it('accepts BOM + CRLF from Windows and stages BOM-free UTF-8', async () => {
    let staged = '';
    installFromLocalDirMock.mockImplementationOnce(async (...args: unknown[]) => {
      const { sourceDir } = args[0] as { sourceDir: string };
      staged = readFileSync(join(sourceDir, 'SKILL.md'), 'utf8');
    });
    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    await saveUserSkill({
      slug: 'demo-skill',
      skillMd: '\uFEFF---\r\nname: demo-skill\r\ntitle: 中文技能\r\ndescription: 中文说明\r\n---\r\n\r\n正文\r\n',
    });
    expect(staged).toBe('---\nname: demo-skill\ntitle: "中文技能"\ndescription: 中文说明\n---\n\n正文\n');
  });

  it('ALREADY_EXISTS when force=false and user entry present', async () => {
    const packageDir = join(tempRoot, 'users', 'u1205314', 'skills', 'demo-skill');
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, 'SKILL.md'), '---\nname: demo-skill\ndescription: x\n---\n', 'utf8');

    const store = await import('../../electron/services/skills/canonical-store');
    await store.upsertSkillEntry({
      slug: 'demo-skill',
      scope: 'user',
      userCode: 'u1205314',
      version: '1.0.0',
      source: 'local',
      enabled: true,
    });

    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    await expect(
      saveUserSkill({
        slug: 'demo-skill',
        skillMd: '---\nname: demo-skill\ndescription: newer\n---\n\n# Demo\n',
        force: false,
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(installFromLocalDirMock).not.toHaveBeenCalled();
  });

  it('blocks path traversal in assets', async () => {
    const { saveUserSkill } = await import('../../electron/services/skills/create-user-skill');
    await expect(
      saveUserSkill({
        slug: 'demo-skill',
        skillMd: '---\nname: demo-skill\ndescription: demo\n---\n\n# Demo\n',
        assets: [{ path: '../evil.txt', content: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
  });
});
