import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeMoreAppsRegistry,
  readMoreAppsRegistry,
  writeMoreAppsRegistry,
} from '@electron/services/more-apps-store';

describe('more apps file registry', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempRegistryPath(): string {
    const dir = mkdtempSync(join(tmpdir(), 'stoclaw-more-apps-'));
    tempDirs.push(dir);
    return join(dir, 'apps.json');
  }

  it('normalizes ids and writes favorites to apps.json', () => {
    const path = tempRegistryPath();
    const registry = normalizeMoreAppsRegistry({
      version: 1,
      externalApps: [],
      installedIds: [],
      favoriteIds: ['app-a', 'app-a', ''],
    });
    writeMoreAppsRegistry(registry, path);

    expect(registry.favoriteIds).toEqual(['app-a']);
    expect(readMoreAppsRegistry(path)).toEqual(registry);
    expect(JSON.parse(readFileSync(path, 'utf-8')).favoriteIds).toEqual(['app-a']);
  });
});
