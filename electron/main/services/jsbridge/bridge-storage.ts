import Store from 'electron-store';

interface BridgeStorageSchema {
  entries: Record<string, unknown>;
}

const stores = new Map<string, Store<BridgeStorageSchema>>();

function storageKey(appId: string, sessionId: string, untrusted: boolean): string {
  return untrusted ? `${appId}::session::${sessionId}` : appId;
}

function getStore(namespace: string): Store<BridgeStorageSchema> {
  const existing = stores.get(namespace);
  if (existing) return existing;
  const store = new Store<BridgeStorageSchema>({
    name: `bridge-storage-${namespace.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    projectName: 'sto-claw',
    defaults: { entries: {} },
  });
  stores.set(namespace, store);
  return store;
}

export function bridgeStorageGet(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
}): unknown {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  return getStore(ns).get(`entries.${input.key}`, undefined);
}

export function bridgeStorageSet(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
  value: unknown;
}): void {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  getStore(ns).set(`entries.${input.key}`, input.value);
}

export function bridgeStorageRemove(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
}): void {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  const store = getStore(ns);
  const entries = { ...store.get('entries') };
  delete entries[input.key];
  store.set('entries', entries);
}

export function bridgeStorageClear(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
}): void {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  getStore(ns).set('entries', {});
}
