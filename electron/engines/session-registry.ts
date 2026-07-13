import type { AgentEngineType } from './types';
import {
  deleteEngineBinding,
  ensureSessionCatalogBootstrapped,
  getEngineBinding,
  listEngineBindings,
  upsertEngineBinding,
} from '../services/session-catalog-service';
import type { EngineSessionRegistryEntry } from './session-registry-types';

export type { EngineSessionRegistryEntry } from './session-registry-types';

let registryMutationQueue: Promise<void> = Promise.resolve();

async function waitForRegistryMutations(): Promise<void> {
  await registryMutationQueue.catch(() => {});
}

async function runRegistryMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const next = registryMutationQueue.then(mutation);
  registryMutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function listEngineSessionRegistryEntries(
  engineType?: AgentEngineType,
): Promise<EngineSessionRegistryEntry[]> {
  await waitForRegistryMutations();
  await ensureSessionCatalogBootstrapped();
  return listEngineBindings(engineType);
}

export async function getEngineSessionRegistryEntry(
  sessionKey: string,
): Promise<EngineSessionRegistryEntry | null> {
  await waitForRegistryMutations();
  await ensureSessionCatalogBootstrapped();
  return getEngineBinding(sessionKey);
}

export async function upsertEngineSessionRegistryEntry(
  entry: EngineSessionRegistryEntry,
): Promise<void> {
  await runRegistryMutation(async () => {
    await upsertEngineBinding(entry);
  });
}

export async function deleteEngineSessionRegistryEntry(
  sessionKey: string,
): Promise<EngineSessionRegistryEntry | null> {
  return runRegistryMutation(async () => deleteEngineBinding(sessionKey));
}
