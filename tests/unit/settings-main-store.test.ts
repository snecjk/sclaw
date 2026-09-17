import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();

vi.mock('electron', () => ({
  app: {
    getPreferredSystemLanguages: () => ['en'],
    getLocale: () => 'en',
  },
}));

vi.mock('electron-store', () => ({
  default: class MockStore {
    constructor(options: { defaults: Record<string, unknown> }) {
      for (const [key, value] of Object.entries(options.defaults)) {
        if (!storeData.has(key)) storeData.set(key, value);
      }
    }

    get store() {
      return Object.fromEntries(storeData);
    }

    has(key: string) {
      return storeData.has(key);
    }

    get(key: string) {
      return storeData.get(key);
    }

    set(key: string, value: unknown) {
      storeData.set(key, value);
    }

    clear() {
      storeData.clear();
    }
  },
}));

describe('main-process settings store', () => {
  beforeEach(() => {
    storeData.clear();
    vi.resetModules();
  });

  it('turns off the previously persisted Skill discovery default once', async () => {
    storeData.set('skillDiscoveryEnabled', true);

    const { getAllSettings } = await import('../../electron/utils/store');
    const settings = await getAllSettings();

    expect(settings.skillDiscoveryEnabled).toBe(false);
    expect(storeData.get('_skillDiscoveryDefaultOffMigrationV1')).toBe(true);
    expect(settings).not.toHaveProperty('_skillDiscoveryDefaultOffMigrationV1');
  });

  it('preserves the user choice after the one-shot migration', async () => {
    storeData.set('skillDiscoveryEnabled', true);
    storeData.set('_skillDiscoveryDefaultOffMigrationV1', true);

    const { getSetting } = await import('../../electron/utils/store');

    expect(await getSetting('skillDiscoveryEnabled')).toBe(true);
  });
});
