import type { AgentEngineType } from './types';
import {
  deleteEngineBinding,
  ensureSessionCatalogBootstrapped,
  getEngineBinding,
  listEngineBindings,
  upsertEngineBinding,
} from '../services/session-catalog-service';
import type { EngineSessionRegistryEntry } from './session-registry-types';
import { deleteSessionSkillState } from '../services/skills/session-skill-state-service';

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

/** Patch volatile metadata without making callers reconstruct ownership fields. */
export async function patchEngineSessionRegistryEntry(
  sessionKey: string,
  patch: Partial<Omit<EngineSessionRegistryEntry, 'sessionKey' | 'engineType' | 'agentId'>>,
): Promise<void> {
  await runRegistryMutation(async () => {
    await ensureSessionCatalogBootstrapped();
    const current = await getEngineBinding(sessionKey);
    if (!current) return;
    await upsertEngineBinding({ ...current, ...patch, sessionKey });
  });
}

export async function deleteEngineSessionRegistryEntry(
  sessionKey: string,
): Promise<EngineSessionRegistryEntry | null> {
  return runRegistryMutation(async () => {
    const removed = await deleteEngineBinding(sessionKey);
    await deleteSessionSkillState(sessionKey);
    return removed;
  });
}
