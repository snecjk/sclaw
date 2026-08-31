import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspaceRoot = vi.hoisted(() => ({ current: '' }));

vi.hoisted(() => {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: process.cwd(),
  });
});

vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd() },
}));

vi.mock('../../electron/services/session-catalog-service', () => ({
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getWorkspaceRootPath: vi.fn(async () => workspaceRoot.current),
  listUserWorkspaces: vi.fn(async () => []),
}));

import { ensureAppDevContext } from '../../electron/services/app-dev-service';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('应用开发外部服务上下文', () => {
  it('先用可选 keyword 的 list 选择服务，再 describe 一个明确版本', async () => {
    const appPath = await mkdtemp(join(tmpdir(), 'sclaw-app-dev-context-'));
    roots.push(appPath);
    workspaceRoot.current = appPath;
    await mkdir(join(appPath, '.sclaw'), { recursive: true });
    await writeFile(join(appPath, '.sclaw', 'app-dev.json'), JSON.stringify({
      kind: 'app-dev',
      name: '外部服务测试应用',
      projectType: 'frontend',
      createdAt: '2026-08-31T00:00:00.000Z',
    }));

    await ensureAppDevContext('ws-external-service');

    const agents = await readFile(join(appPath, '.sclaw', 'AGENTS.md'), 'utf8');
    expect(agents).toContain('sai-cli siteapp external-service list --keyword');
    expect(agents).toContain('sai-cli siteapp external-service describe');
    expect(agents).toContain('一次只');
    expect(agents).toContain('sai-cli discover');
    expect(agents.indexOf('siteapp external-service list --keyword')).toBeLessThan(
      agents.indexOf('sai-cli discover'),
    );
    expect(agents).not.toContain('siteapp external-service search');
    expect(agents).toContain('先引导用户指定 CLI 接口');
    expect(agents).toContain('请告诉我要用哪条 sai-cli 指令');

    const pageSkill = await readFile(
      join(appPath, 'openspec', 'skills', 'nl-page-from-sai', 'SKILL.md'),
      'utf8',
    );
    expect(pageSkill).toContain('sai-cli siteapp external-service list --keyword');
    expect(pageSkill).toContain('sai-cli siteapp external-service describe');
    expect(pageSkill).not.toContain('siteapp external-service search');
    expect(pageSkill).toContain('先引导用户指定 CLI');
    expect(pageSkill.indexOf('siteapp external-service list --keyword')).toBeLessThan(
      pageSkill.indexOf('先引导用户指定 CLI'),
    );

    const visualSkill = await readFile(
      join(appPath, 'openspec', 'skills', 'sto-pc-visual', 'SKILL.md'),
      'utf8',
    );
    expect(visualSkill).toContain('STO PC Visual');
    expect(visualSkill).toContain('#FF6700');
    expect(agents).toContain('openspec/skills/sto-pc-visual/SKILL.md');
    await expect(readFile(join(appPath, 'openspec', 'skills', 'sto-pc-visual', 'tokens.css'), 'utf8'))
      .resolves.toContain('--shell-topbar: 60px');
    await expect(readFile(join(appPath, 'openspec', 'skills', 'sto-pc-visual', 'reference.html'), 'utf8'))
      .resolves.toContain('sto-opentabs');
    await expect(readFile(join(appPath, 'openspec', 'skills', 'sto-pc-visual', 'assets', 'sto-mark.svg'), 'utf8'))
      .resolves.toContain('viewBox="0 0 67.81');
  });
});
