import { describe, expect, it } from 'vitest';
import { prependNodePathEntry, prependPathEntry } from '@electron/utils/env-path';

describe('env-path', () => {
  it('prepends NODE_PATH entries', () => {
    const next = prependNodePathEntry({ NODE_PATH: '/existing' }, '/openclaw/node_modules');
    expect(next.NODE_PATH).toBe('/openclaw/node_modules:/existing');
  });

  it('sets NODE_PATH when missing', () => {
    const next = prependNodePathEntry({}, '/openclaw/node_modules');
    expect(next.NODE_PATH).toBe('/openclaw/node_modules');
  });

  it('prepends PATH entries on Windows-style env', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
    try {
      const { env, path } = prependPathEntry({ Path: 'C:\\Windows' }, 'C:\\bin');
      expect(path).toBe('C:\\bin;C:\\Windows');
      expect(env.Path).toBe('C:\\bin;C:\\Windows');
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    }
  });
});
