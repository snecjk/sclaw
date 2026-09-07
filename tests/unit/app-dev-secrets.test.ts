import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeData = new Map<string, unknown>();

vi.mock('electron-store', () => ({
  default: class MockStore {
    get(key: string) {
      return storeData.get(key);
    }
    set(key: string, value: unknown) {
      storeData.set(key, value);
    }
  },
}));

describe('app-dev-secrets', () => {
  beforeEach(() => {
    storeData.clear();
    vi.resetModules();
  });

  it('lists keys without values and rejects path-like keys', async () => {
    const {
      assertSecretKey,
      deleteAppDevSecret,
      getAppDevSecretsEnv,
      listAppDevSecretKeys,
      setAppDevSecret,
    } = await import('../../electron/services/app-dev-secrets');

    expect(() => assertSecretKey('../etc')).toThrow();
    expect(() => assertSecretKey('bad/key')).toThrow();
    expect(() => assertSecretKey('1bad')).toThrow();

    await setAppDevSecret('ws-1', 'SESSION_SECRET', 'super-secret-value');
    expect(await listAppDevSecretKeys('ws-1')).toEqual(['SESSION_SECRET']);
    const env = await getAppDevSecretsEnv('ws-1');
    expect(env.SESSION_SECRET).toBe('super-secret-value');
    // list API surface never returns values — only keys
    expect(JSON.stringify(await listAppDevSecretKeys('ws-1'))).not.toContain('super-secret');

    await deleteAppDevSecret('ws-1', 'SESSION_SECRET');
    expect(await listAppDevSecretKeys('ws-1')).toEqual([]);
  });
});
