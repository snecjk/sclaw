import { describe, expect, it, vi } from 'vitest';
import {
  SSO_CODE_FIELD_RELOGIN_DONE_KEY,
  ensureSsoCodeFieldReloginOnce,
} from '../../electron/utils/auth-store';

function memoryStore(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    get: (key: string) => data[key],
    set: (key: string, value: unknown) => {
      data[key] = value;
    },
  };
}

describe('ensureSsoCodeFieldReloginOnce', () => {
  it('clears auth and marks the key when logged in and not yet done', async () => {
    const store = memoryStore();
    const clearAuth = vi.fn(async () => {});
    const result = await ensureSsoCodeFieldReloginOnce({
      store,
      isLoggedIn: async () => true,
      clearAuth,
    });
    expect(result).toEqual({ skipped: false, cleared: true });
    expect(clearAuth).toHaveBeenCalledTimes(1);
    expect(store.get(SSO_CODE_FIELD_RELOGIN_DONE_KEY)).toBe(true);
  });

  it('does not clear when the key is already true', async () => {
    const store = memoryStore({ [SSO_CODE_FIELD_RELOGIN_DONE_KEY]: true });
    const clearAuth = vi.fn(async () => {});
    const isLoggedIn = vi.fn(async () => true);
    const result = await ensureSsoCodeFieldReloginOnce({
      store,
      isLoggedIn,
      clearAuth,
    });
    expect(result).toEqual({ skipped: true, cleared: false });
    expect(clearAuth).not.toHaveBeenCalled();
    expect(isLoggedIn).not.toHaveBeenCalled();
  });

  it('only marks the key when not logged in', async () => {
    const store = memoryStore();
    const clearAuth = vi.fn(async () => {});
    const result = await ensureSsoCodeFieldReloginOnce({
      store,
      isLoggedIn: async () => false,
      clearAuth,
    });
    expect(result).toEqual({ skipped: false, cleared: false });
    expect(clearAuth).not.toHaveBeenCalled();
    expect(store.get(SSO_CODE_FIELD_RELOGIN_DONE_KEY)).toBe(true);
  });

  it('does not mark the key when the login check throws, so next launch retries', async () => {
    const store = memoryStore();
    const clearAuth = vi.fn(async () => {});
    await expect(
      ensureSsoCodeFieldReloginOnce({
        store,
        isLoggedIn: async () => {
          throw new Error('sai unreadable');
        },
        clearAuth,
      }),
    ).rejects.toThrow('sai unreadable');
    expect(clearAuth).not.toHaveBeenCalled();
    expect(store.get(SSO_CODE_FIELD_RELOGIN_DONE_KEY)).toBeUndefined();
  });

  it('does not mark the key when clearAuth throws, so next launch retries', async () => {
    const store = memoryStore();
    const clearAuth = vi.fn(async () => {
      throw new Error('teardown failed');
    });
    await expect(
      ensureSsoCodeFieldReloginOnce({
        store,
        isLoggedIn: async () => true,
        clearAuth,
      }),
    ).rejects.toThrow('teardown failed');
    expect(store.get(SSO_CODE_FIELD_RELOGIN_DONE_KEY)).toBeUndefined();
  });
});
