import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roots = vi.hoisted(() => ({
  openclaw: '',
}));

vi.mock('../../electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('../../electron/utils/paths')>(
    '../../electron/utils/paths',
  );
  return {
    ...actual,
    getOpenClawConfigDir: () => roots.openclaw,
    getOpenClawSkillsDir: () => join(roots.openclaw, 'skills'),
    getOpenClawAgentSkillsDir: (agentId: string) =>
      join(roots.openclaw, 'agents', agentId, 'agent', 'skills'),
  };
});

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const setSkillsEnabled = vi.fn(async () => undefined);
const updateSkillConfig = vi.fn(async () => ({ success: true }));

vi.mock('../../electron/utils/skill-config', () => ({
  setSkillsEnabled: (...args: unknown[]) => setSkillsEnabled(...args),
  updateSkillConfig: (...args: unknown[]) => updateSkillConfig(...args),
}));

vi.mock('../../electron/services/project-agent-service', () => ({
  syncBaseAgentSkillInstall: vi.fn(async () => undefined),
  syncBaseAgentSkillUninstall: vi.fn(async () => undefined),
}));

vi.mock('../../electron/services/skills/adapters/engine-skill-adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../../electron/services/skills/adapters/engine-skill-adapter')
  >('../../electron/services/skills/adapters/engine-skill-adapter');
  return {
    ...actual,
    notifyGatewayAfterSkillBatch: vi.fn(async () => undefined),
  };
});

async function writeSkill(dir: string, name = 'demo'): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`,
    'utf-8',
  );
}

describe('OpenClawSkillAdapter disable = remove from skills/', () => {
  let tempRoot: string;
  let sourceDir: string;

  beforeEach(async () => {
    vi.resetModules();
    setSkillsEnabled.mockClear();
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-oc-adapter-'));
    roots.openclaw = join(tempRoot, 'openclaw');
    sourceDir = join(tempRoot, 'store', 'demo');
    await mkdir(join(roots.openclaw, 'skills'), { recursive: true });
    await writeSkill(sourceDir, 'demo');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('projects enabled skills into openclaw/skills and removes them on disable', async () => {
    const { OpenClawSkillAdapter } = await import(
      '../../electron/services/skills/adapters/openclaw-skill-adapter'
    );
    const adapter = new OpenClawSkillAdapter();
    const pkg = {
      slug: 'demo',
      sourceDir,
      version: '1.0.0',
      enabled: true,
      scope: 'user' as const,
      userCode: 'u1',
    };

    await adapter.applyInstall(pkg, { userCode: 'u1' });
    expect(existsSync(join(roots.openclaw, 'skills', 'demo', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(roots.openclaw, 'skills-disabled', 'demo'))).toBe(false);

    await adapter.applyEnabled('demo', false, { userCode: 'u1' });
    expect(existsSync(join(roots.openclaw, 'skills', 'demo'))).toBe(false);
    expect(existsSync(join(roots.openclaw, 'skills-disabled', 'demo'))).toBe(false);
    expect(setSkillsEnabled).toHaveBeenCalledWith(['demo'], false);
  });

  it('reconcile does not write disabled skills into skills-disabled and purges legacy copies', async () => {
    const { OpenClawSkillAdapter } = await import(
      '../../electron/services/skills/adapters/openclaw-skill-adapter'
    );
    const adapter = new OpenClawSkillAdapter();

    const legacyDisabled = join(roots.openclaw, 'skills-disabled', 'demo');
    await writeSkill(legacyDisabled, 'demo');
    await writeFile(
      join(legacyDisabled, '.stoclaw-openclaw-skill-projection.json'),
      JSON.stringify({ source: 'stoclaw-skills-store', slug: 'demo' }),
      'utf-8',
    );
    await writeSkill(join(roots.openclaw, 'skills', 'demo'), 'demo');
    await writeFile(
      join(roots.openclaw, 'skills', 'demo', '.stoclaw-openclaw-skill-projection.json'),
      JSON.stringify({ source: 'stoclaw-skills-store', slug: 'demo' }),
      'utf-8',
    );

    const result = await adapter.reconcile(
      [{
        slug: 'demo',
        sourceDir,
        version: '1.0.0',
        enabled: false,
        scope: 'user',
        userCode: 'u1',
      }],
      { userCode: 'u1' },
    );

    expect(existsSync(join(roots.openclaw, 'skills', 'demo'))).toBe(false);
    expect(existsSync(join(roots.openclaw, 'skills-disabled', 'demo'))).toBe(false);
    expect(result.mirrored).toContain('demo');
  });

  it('reconcile projects enabled skills and keeps managed marker', async () => {
    const { OpenClawSkillAdapter } = await import(
      '../../electron/services/skills/adapters/openclaw-skill-adapter'
    );
    const adapter = new OpenClawSkillAdapter();
    await adapter.reconcile(
      [{
        slug: 'demo',
        sourceDir,
        version: '1.0.0',
        enabled: true,
        scope: 'global',
      }],
      { userCode: null },
    );

    const marker = join(
      roots.openclaw,
      'skills',
      'demo',
      '.stoclaw-openclaw-skill-projection.json',
    );
    expect(existsSync(join(roots.openclaw, 'skills', 'demo', 'SKILL.md'))).toBe(true);
    expect(existsSync(marker)).toBe(true);
    const body = JSON.parse(await readFile(marker, 'utf-8')) as { source?: string };
    expect(body.source).toBe('stoclaw-skills-store');
  });
});
