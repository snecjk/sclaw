import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  migrateMoreAppsRegistry,
  normalizeMoreAppsRegistry,
  readMoreAppsRegistry,
  writeMoreAppsRegistry,
} from '@electron/services/more-apps-store';
import { createEmptyMoreAppsRegistry } from '../../shared/more-apps-registry';

describe('more-apps-store', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempRegistryPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'stoclaw-more-apps-'));
    tempDirs.push(dir);
    return join(dir, 'apps.json');
  }

  it('normalizeMoreAppsRegistry drops invalid apps and dedupes ids', () => {
    const normalized = normalizeMoreAppsRegistry({
      version: 1,
      externalApps: [
        { id: 'a', name: 'A', url: 'https://a.example' },
        { id: '', name: 'bad', url: 'https://x' },
        { name: 'no-id', url: 'https://y' },
        { id: 'b', url: 'https://b.example' },
      ],
      installedIds: ['a', 'a', ' ', 'b', 1],
      favoriteIds: ['b', 'b'],
    });

    expect(normalized.externalApps).toHaveLength(2);
    expect(normalized.externalApps.map((a) => a.id)).toEqual(['a', 'b']);
    expect(normalized.installedIds).toEqual(['a', 'b']);
    expect(normalized.favoriteIds).toEqual(['b']);
  });

  it('write and read round-trip under custom path', () => {
    const path = tempRegistryPath();
    const written = writeMoreAppsRegistry(
      {
        version: 1,
        externalApps: [
          {
            id: 'ext-1',
            name: 'CRM',
            url: 'https://crm.example',
            kind: 'external',
            external: true,
          },
        ],
        installedIds: ['ext-1', 'builtin-x'],
        favoriteIds: ['builtin-x'],
      },
      path,
    );

    expect(written.externalApps[0]?.name).toBe('CRM');
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    expect(raw.version).toBe(1);
    expect(readMoreAppsRegistry(path)).toEqual(written);
  });

  it('migrate writes when disk is empty', () => {
    const path = tempRegistryPath();
    const result = migrateMoreAppsRegistry(
      {
        version: 1,
        externalApps: [{ id: 'ext-legacy', name: 'Legacy', url: 'https://legacy.example' }],
        installedIds: ['ext-legacy'],
        favoriteIds: [],
      },
      path,
    );

    expect(result.migrated).toBe(true);
    expect(result.registry.externalApps).toHaveLength(1);
    expect(readMoreAppsRegistry(path).externalApps[0]?.id).toBe('ext-legacy');
  });

  it('migrate does not overwrite non-empty disk', () => {
    const path = tempRegistryPath();
    writeMoreAppsRegistry(
      {
        version: 1,
        externalApps: [{ id: 'disk', name: 'Disk', url: 'https://disk.example' }],
        installedIds: ['disk'],
        favoriteIds: [],
      },
      path,
    );

    const result = migrateMoreAppsRegistry(
      {
        version: 1,
        externalApps: [{ id: 'legacy', name: 'Legacy', url: 'https://legacy.example' }],
        installedIds: ['legacy'],
        favoriteIds: ['legacy'],
      },
      path,
    );

    expect(result.migrated).toBe(false);
    expect(result.registry.externalApps[0]?.id).toBe('disk');
    expect(readMoreAppsRegistry(path).externalApps[0]?.id).toBe('disk');
  });

  it('migrate with empty payload leaves empty disk untouched', () => {
    const path = tempRegistryPath();
    writeFileSync(path, JSON.stringify(createEmptyMoreAppsRegistry()), 'utf-8');
    const result = migrateMoreAppsRegistry(createEmptyMoreAppsRegistry(), path);
    expect(result.migrated).toBe(false);
    expect(result.registry.externalApps).toEqual([]);
  });
});
