import type Store from 'electron-store';
import type { Capability } from '../../../../shared/jsbridge/capabilities';
import { isCapability } from '../../../../shared/jsbridge/capabilities';

interface ConsentRecord {
  appId: string;
  capability: Capability;
  grantedAt: number;
  grantedBy?: string;
}

interface ConsentStoreSchema {
  consents: ConsentRecord[];
}

let store: Store<ConsentStoreSchema> | null = null;
let storeInit: Promise<Store<ConsentStoreSchema>> | null = null;

async function getStore(): Promise<Store<ConsentStoreSchema>> {
  if (store) return store;
  if (!storeInit) {
    storeInit = (async () => {
      const mod = await import('electron-store');
      const StoreCtor = mod.default ?? mod;
      const instance = new StoreCtor<ConsentStoreSchema>({
        name: 'bridge-consents',
        projectName: 'sto-claw',
        defaults: { consents: [] },
      });
      store = instance;
      return instance;
    })();
  }
  return storeInit;
}

/** Preload consent store before sync bridge session creation. */
export async function ensureBridgeConsentStore(): Promise<void> {
  await getStore();
}

export function hasBridgeConsent(appId: string, capability: Capability): boolean {
  if (!store) return false;
  return store.get('consents').some(
    (entry) => entry.appId === appId && entry.capability === capability,
  );
}

export async function grantBridgeConsent(input: {
  appId: string;
  capability: Capability;
  grantedBy?: string;
}): Promise<void> {
  if (!isCapability(input.capability)) return;
  const consentStore = await getStore();
  const consents = consentStore.get('consents').filter(
    (entry) => !(entry.appId === input.appId && entry.capability === input.capability),
  );
  consents.push({
    appId: input.appId,
    capability: input.capability,
    grantedAt: Date.now(),
    grantedBy: input.grantedBy,
  });
  consentStore.set('consents', consents);
}

export async function revokeBridgeAppConsents(appId: string): Promise<void> {
  const consentStore = await getStore();
  consentStore.set(
    'consents',
    consentStore.get('consents').filter((entry) => entry.appId !== appId),
  );
}

export async function listBridgeConsents(appId?: string): Promise<ConsentRecord[]> {
  const consentStore = await getStore();
  const consents = consentStore.get('consents');
  return appId ? consents.filter((entry) => entry.appId === appId) : consents;
}

export async function revokeBridgeConsent(appId: string, capability: Capability): Promise<void> {
  const consentStore = await getStore();
  consentStore.set(
    'consents',
    consentStore.get('consents').filter(
      (entry) => !(entry.appId === appId && entry.capability === capability),
    ),
  );
}
