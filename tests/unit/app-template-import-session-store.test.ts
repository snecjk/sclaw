import { afterEach, describe, expect, it } from 'vitest';

import type { PreparedTemplateImport } from '../../electron/services/app-template-import-scanner';
import { AppTemplateImportSessionStore } from '../../electron/services/app-template-import-session-store';

function prepared(snapshotRoot: string): PreparedTemplateImport {
  return {
    snapshotRoot,
    sourcePath: '/source/demo',
    sourceFingerprint: 'fingerprint',
    importFiles: {},
    mergedPackageJson: {},
    preview: {
      sourceName: 'demo',
      detectedStack: 'react-vite',
      pageType: 'site',
      changes: [],
      ignoredPaths: [],
      packageChanges: [],
      issues: [],
    },
  };
}

describe('AppTemplateImportSessionStore', () => {
  const stores: AppTemplateImportSessionStore[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.dispose()));
  });

  it('binds a token to one workspace and only allows it to be taken once', () => {
    const store = new AppTemplateImportSessionStore({ removeSnapshot: async () => undefined });
    stores.push(store);
    const created = store.create('ws-1', prepared('/tmp/snapshot'));

    expect(() => store.take(created.importToken, 'ws-2')).toThrow('导入会话不属于当前模板');
    expect(store.take(created.importToken, 'ws-1').prepared.snapshotRoot).toBe('/tmp/snapshot');
    expect(() => store.take(created.importToken, 'ws-1')).toThrow('导入会话不存在或已使用');
  });

  it('expires after ten minutes and removes the snapshot', async () => {
    let now = 1_000;
    const removed: string[] = [];
    const store = new AppTemplateImportSessionStore({
      now: () => now,
      removeSnapshot: async (path) => { removed.push(path); },
    });
    stores.push(store);
    const created = store.create('ws-1', prepared('/tmp/expired'));

    expect(created.expiresAt).toBe(new Date(now + 10 * 60 * 1_000).toISOString());
    now += 10 * 60 * 1_000 + 1;

    await expect(store.cancel(created.importToken, 'ws-1')).resolves.toBe(false);
    expect(removed).toContain('/tmp/expired');
  });

  it('cancel validates ownership and cleans the snapshot', async () => {
    const removed: string[] = [];
    const store = new AppTemplateImportSessionStore({
      removeSnapshot: async (path) => { removed.push(path); },
    });
    stores.push(store);
    const created = store.create('ws-1', prepared('/tmp/cancelled'));

    await expect(store.cancel(created.importToken, 'ws-2')).rejects.toThrow('导入会话不属于当前模板');
    await expect(store.cancel(created.importToken, 'ws-1')).resolves.toBe(true);
    expect(removed).toEqual(['/tmp/cancelled']);
  });
});
