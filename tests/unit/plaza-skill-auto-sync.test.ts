import { describe, expect, it } from 'vitest';
import { collectPlazaAutoSyncActions } from '../../electron/services/plaza-skill-auto-sync';

describe('collectPlazaAutoSyncActions', () => {
  const emptyPreinstall = {
    preinstalledManifestSlugs: new Set<string>(),
    preinstalledSourceSlugs: new Set<string>(),
  };

  it('schedules force-update when installed and remote is newer', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: '网点面单',
          forceUpdate: true,
          isBuiltin: false,
          installed: true,
          version: 'v105',
          installedVersion: 'v100',
          title: '网点面单',
        },
      ],
      emptyPreinstall,
    );
    expect(actions).toEqual([
      expect.objectContaining({
        slug: '网点面单',
        kind: 'force-update',
        version: 'v105',
      }),
    ]);
  });

  it('skips force-update when versions are aligned', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: '网点面单',
          forceUpdate: true,
          installed: true,
          version: 'v105',
          installedVersion: 'v105',
        },
      ],
      emptyPreinstall,
    );
    expect(actions).toEqual([]);
  });

  it('skips force-update when not installed', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: '网点面单',
          forceUpdate: true,
          installed: false,
          version: 'v105',
        },
      ],
      emptyPreinstall,
    );
    expect(actions).toEqual([]);
  });

  it('schedules builtin-install when missing', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: 'builtin-demo',
          isBuiltin: true,
          installed: false,
          version: '1.0.0',
          title: 'Builtin',
        },
      ],
      emptyPreinstall,
    );
    expect(actions).toEqual([
      expect.objectContaining({
        slug: 'builtin-demo',
        kind: 'builtin-install',
      }),
    ]);
  });

  it('skips builtin when already installed', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: 'builtin-demo',
          isBuiltin: true,
          installed: true,
          version: '1.0.0',
        },
      ],
      emptyPreinstall,
    );
    expect(actions).toEqual([]);
  });

  it('skips local preinstall whitelist and stoclaw-preinstalled sources', () => {
    const actions = collectPlazaAutoSyncActions(
      [
        {
          slug: 'claw-archiver',
          forceUpdate: true,
          isBuiltin: true,
          installed: true,
          version: '2.0.0',
          installedVersion: '1.0.0',
        },
        {
          slug: 'sai-cli',
          forceUpdate: true,
          installed: true,
          version: '2.0.0',
          installedVersion: '1.0.0',
        },
      ],
      {
        preinstalledManifestSlugs: new Set(['claw-archiver']),
        preinstalledSourceSlugs: new Set(['sai-cli']),
      },
    );
    expect(actions).toEqual([]);
  });
});
