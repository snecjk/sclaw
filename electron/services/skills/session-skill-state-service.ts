import { getSessionSkillStateRepository } from '../../db/repositories/session-skill-state-repository';
import {
  beginSessionSkillTurn,
  emptySessionSkillState,
  finishSessionSkillTurn,
  markSessionSkillUsed,
  pruneSessionSkillLeases,
  recoverInterruptedSkillTurns,
  type SelectedSkillInput,
  type SessionSkillState,
} from './session-skill-state';

const mutationQueues = new Map<string, Promise<void>>();
const recoveredSessions = new Set<string>();
let cleanupScheduled = false;

async function mutate(
  sessionKey: string,
  operation: (state: SessionSkillState) => SessionSkillState | Promise<SessionSkillState>,
): Promise<SessionSkillState> {
  let result: SessionSkillState | undefined;
  const previous = mutationQueues.get(sessionKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    const repository = getSessionSkillStateRepository();
    let state = await repository.get(sessionKey) ?? emptySessionSkillState(sessionKey);
    if (!recoveredSessions.has(sessionKey)) {
      state = recoverInterruptedSkillTurns(state);
      recoveredSessions.add(sessionKey);
    }
    result = await operation(state);
    await repository.upsert(result);
  });
  mutationQueues.set(sessionKey, next.then(() => undefined, () => undefined));
  await next;
  return result!;
}

function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  void getSessionSkillStateRepository().deleteOlderThan(cutoff).catch(() => {});
}

export async function beginSkillTurn(input: {
  sessionKey: string;
  runId: string;
  manifestRevision: string;
  query: string;
  taskFingerprint?: string;
  selected: SelectedSkillInput[];
  remoteSearched: boolean;
  topicChanged?: boolean;
}): Promise<SessionSkillState> {
  scheduleCleanup();
  return mutate(input.sessionKey, (state) => beginSessionSkillTurn(state, input));
}

export async function markSkillUsed(sessionKey: string, runId: string, slug: string): Promise<void> {
  await mutate(sessionKey, (state) => markSessionSkillUsed(state, runId, slug));
}

export async function completeSkillTurn(
  sessionKey: string,
  runId: string,
  taskFingerprint?: string,
): Promise<void> {
  await mutate(sessionKey, (state) => finishSessionSkillTurn(state, runId, true, taskFingerprint));
}

export async function failSkillTurn(sessionKey: string, runId: string): Promise<void> {
  await mutate(sessionKey, (state) => finishSessionSkillTurn(state, runId, false));
}

export async function getSessionSkillState(sessionKey: string): Promise<SessionSkillState> {
  return mutate(sessionKey, (state) => state);
}

export async function reconcileSessionSkillState(
  sessionKey: string,
  validSkills: ReadonlyMap<string, string>,
): Promise<SessionSkillState> {
  return mutate(sessionKey, (state) => pruneSessionSkillLeases(state, state.turnNo + 1, validSkills));
}

export async function deleteSessionSkillState(sessionKey: string): Promise<void> {
  const previous = mutationQueues.get(sessionKey);
  if (previous) await previous.catch(() => {});
  mutationQueues.delete(sessionKey);
  recoveredSessions.delete(sessionKey);
  await getSessionSkillStateRepository().delete(sessionKey);
}
