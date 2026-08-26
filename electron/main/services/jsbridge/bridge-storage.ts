import type Store from 'electron-store';

interface BridgeStorageSchema {
  entries: Record<string, unknown>;
}

const stores = new Map<string, Store<BridgeStorageSchema>>();
const storeInits = new Map<string, Promise<Store<BridgeStorageSchema>>>();

function storageKey(appId: string, sessionId: string, untrusted: boolean): string {
  return untrusted ? `${appId}::session::${sessionId}` : appId;
}

async function getStore(namespace: string): Promise<Store<BridgeStorageSchema>> {
  const existing = stores.get(namespace);
  if (existing) return existing;

  let init = storeInits.get(namespace);
  if (!init) {
    init = (async () => {
      const mod = await import('electron-store');
      const StoreCtor = mod.default ?? mod;
      const instance = new StoreCtor<BridgeStorageSchema>({
        name: `bridge-storage-${namespace.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        projectName: 'sto-claw',
        defaults: { entries: {} },
      });
      stores.set(namespace, instance);
      return instance;
    })();
    storeInits.set(namespace, init);
  }

  return init;
}

export async function bridgeStorageGet(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
}): Promise<unknown> {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  const store = await getStore(ns);
  return store.get(`entries.${input.key}`, undefined);
}

export async function bridgeStorageSet(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
  value: unknown;
}): Promise<void> {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  const store = await getStore(ns);
  store.set(`entries.${input.key}`, input.value);
}

export async function bridgeStorageRemove(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
  key: string;
}): Promise<void> {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  const store = await getStore(ns);
  const entries = { ...store.get('entries') };
  delete entries[input.key];
  store.set('entries', entries);
}

export async function bridgeStorageClear(input: {
  appId: string;
  sessionId: string;
  untrusted: boolean;
}): Promise<void> {
  const ns = storageKey(input.appId, input.sessionId, input.untrusted);
  const store = await getStore(ns);
  store.set('entries', {});
}
