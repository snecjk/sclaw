import Store from 'electron-store';
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

function getStore(): Store<ConsentStoreSchema> {
  if (!store) {
    store = new Store<ConsentStoreSchema>({
      name: 'bridge-consents',
      projectName: 'sto-claw',
      defaults: { consents: [] },
    });
  }
  return store;
}

export function hasBridgeConsent(appId: string, capability: Capability): boolean {
  return getStore().get('consents').some(
    (entry) => entry.appId === appId && entry.capability === capability,
  );
}

export function grantBridgeConsent(input: {
  appId: string;
  capability: Capability;
  grantedBy?: string;
}): void {
  if (!isCapability(input.capability)) return;
  const consents = getStore().get('consents').filter(
    (entry) => !(entry.appId === input.appId && entry.capability === input.capability),
  );
  consents.push({
    appId: input.appId,
    capability: input.capability,
    grantedAt: Date.now(),
    grantedBy: input.grantedBy,
  });
  getStore().set('consents', consents);
}

export function revokeBridgeAppConsents(appId: string): void {
  getStore().set(
    'consents',
    getStore().get('consents').filter((entry) => entry.appId !== appId),
  );
}

export function listBridgeConsents(appId?: string): ConsentRecord[] {
  const consents = getStore().get('consents');
  return appId ? consents.filter((entry) => entry.appId === appId) : consents;
}

export function revokeBridgeConsent(appId: string, capability: Capability): void {
  getStore().set(
    'consents',
    getStore().get('consents').filter(
      (entry) => !(entry.appId === appId && entry.capability === capability),
    ),
  );
}
