import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const roots = vi.hoisted(() => ({
  store: '',
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
    getOpenClawUserSkillsDir: (userCode: string) => join(roots.openclaw, 'users', userCode, 'skills'),
    getOpenClawUserDisabledDir: (userCode: string) =>
      join(roots.openclaw, 'users', userCode, 'skills-disabled'),
    getOpenClawUserLockDir: (userCode: string) => join(roots.openclaw, 'users', userCode, '.clawhub'),
    getOpenClawUserLockPath: (userCode: string) =>
      join(roots.openclaw, 'users', userCode, '.clawhub', 'lock.json'),
    getSkillsStoreMigratedMarkerPath: () => join(roots.store, '.migrated'),
  };
});

vi.mock('../../electron/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../electron/utils/auth-store', () => ({
  getStoToken: vi.fn(async () => null),
}));

vi.mock('../../electron/utils/sto-memory-api-auth', () => ({
  buildStoMemoryCenterAuthHeaders: vi.fn(() => ({})),
}));

vi.mock('../../electron/utils/sto-domain', () => ({
  resolveStoBaseUrl: vi.fn(() => 'https://example.test'),
}));

vi.mock('../../electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: vi.fn(async () => ({ ok: false })),
}));

vi.mock('../../electron/services/skills/migration', () => ({
  isSkillsStoreMigrated: vi.fn(() => true),
}));

const reconcile = vi.fn(async () => undefined);

vi.mock('../../electron/services/skills/skill-manager', () => ({
  getSkillManager: () => ({
    install: vi.fn(async () => undefined),
    reconcile,
  }),
}));

vi.mock('../../electron/services/skills/canonical-store', () => ({
  getSkillEntry: vi.fn(async () => null),
  resolvePackageDir: vi.fn(() => ''),
}));

vi.mock('../../electron/services/skills/orphan-skill-import', () => ({
  scheduleOrphanSkillImport: vi.fn(),
}));

vi.mock('electron-store', () => {
  const data = new Map<string, unknown>();
  return {
    default: class {
      get(key: string, fallback?: unknown) {
        return data.has(key) ? data.get(key) : fallback;
      }
      set(key: string, value: unknown) {
        data.set(key, value);
      }
    },
  };
});

describe('activateUserWorkspace after skills-store migration', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    reconcile.mockClear();
    tempRoot = await mkdtemp(join(tmpdir(), 'stoclaw-activate-migrated-'));
    roots.store = join(tempRoot, 'skills-store');
    roots.openclaw = join(tempRoot, 'openclaw');
    await mkdir(roots.store, { recursive: true });
    await mkdir(join(roots.openclaw, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('does not recreate openclaw/users when skills-store is migrated', async () => {
    const { activateUserWorkspace } = await import(
      '../../electron/services/user-skill-workspace'
    );
    await activateUserWorkspace('u1');

    expect(existsSync(join(roots.openclaw, 'users'))).toBe(false);
    expect(reconcile).toHaveBeenCalled();
  });
});
