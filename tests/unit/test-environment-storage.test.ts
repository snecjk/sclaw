import { describe, expect, it } from 'vitest';

describe('Vitest browser storage environment', () => {
  it('exposes the jsdom Storage implementation through window and globalThis', () => {
    window.localStorage.setItem('sclaw:test-storage', 'ready');

    expect(globalThis.localStorage.getItem('sclaw:test-storage')).toBe('ready');

    globalThis.localStorage.removeItem('sclaw:test-storage');
    expect(window.localStorage.getItem('sclaw:test-storage')).toBeNull();
  });
});
