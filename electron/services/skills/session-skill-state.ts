export type SessionSkillLeaseState = 'pinned' | 'used' | 'selected';
export type PendingSkillTurnStatus = 'routing' | 'running' | 'completed' | 'failed';

export interface SessionSkillLease {
  slug: string;
  sourceHash: string;
  state: SessionSkillLeaseState;
  score: number;
  reasons: string[];
  selectedAtTurn: number;
  lastUsedTurn?: number;
  expiresAfterTurn?: number;
}

export interface PendingSkillTurn {
  runId: string;
  turnNo: number;
  taskFingerprint?: string;
  selectedSlugs: string[];
  usedSlugs: string[];
  status: PendingSkillTurnStatus;
}

export interface SessionSkillState {
  sessionKey: string;
  turnNo: number;
  manifestRevision: string;
  lastRemoteRouteTurn?: number;
  lastTaskFingerprint?: string;
  lastQuery?: string;
  skills: SessionSkillLease[];
  pendingTurns: Record<string, PendingSkillTurn>;
}

export interface SelectedSkillInput {
  slug: string;
  sourceHash: string;
  state?: SessionSkillLeaseState;
  score?: number;
  reasons?: string[];
}

const normalizeSlug = (value: string): string => value.trim().toLowerCase();

export function emptySessionSkillState(sessionKey: string): SessionSkillState {
  return {
    sessionKey,
    turnNo: 0,
    manifestRevision: '',
    skills: [],
    pendingTurns: {},
  };
}

export function recoverInterruptedSkillTurns(state: SessionSkillState): SessionSkillState {
  if (Object.keys(state.pendingTurns).length === 0) return state;
  return Object.keys(state.pendingTurns).reduce(
    (current, runId) => finishSessionSkillTurn(current, runId, false),
    state,
  );
}

export function pruneSessionSkillLeases(
  state: SessionSkillState,
  turnNo: number,
  validSkills?: ReadonlyMap<string, string>,
): SessionSkillState {
  const skills = state.skills.filter((lease) => {
    if (lease.state !== 'pinned' && lease.expiresAfterTurn !== undefined && lease.expiresAfterTurn < turnNo) {
      return false;
    }
    if (!validSkills) return true;
    return validSkills.get(lease.slug) === lease.sourceHash;
  });
  return skills.length === state.skills.length ? state : { ...state, skills };
}

export function beginSessionSkillTurn(
  current: SessionSkillState,
  input: {
    runId: string;
    manifestRevision: string;
    query: string;
    taskFingerprint?: string;
    selected: SelectedSkillInput[];
    remoteSearched: boolean;
    topicChanged?: boolean;
  },
): SessionSkillState {
  if (current.pendingTurns[input.runId]) return current;
  const turnNo = current.turnNo + 1;
  let state = pruneSessionSkillLeases(current, turnNo);
  if (input.topicChanged) {
    state = { ...state, skills: state.skills.filter((lease) => lease.state === 'pinned') };
  }

  const bySlug = new Map(state.skills.map((lease) => [lease.slug, lease]));
  const selectedSlugs: string[] = [];
  for (const item of input.selected) {
    const slug = normalizeSlug(item.slug);
    if (!slug || selectedSlugs.includes(slug)) continue;
    selectedSlugs.push(slug);
    const existing = bySlug.get(slug);
    const requestedState = item.state ?? 'selected';
    const nextState: SessionSkillLeaseState = existing?.state === 'pinned' || requestedState === 'pinned'
      ? 'pinned'
      : existing?.state === 'used'
        ? 'used'
        : requestedState;
    bySlug.set(slug, {
      slug,
      sourceHash: item.sourceHash,
      state: nextState,
      score: item.score ?? existing?.score ?? 0,
      reasons: [...new Set([...(existing?.reasons ?? []), ...(item.reasons ?? [])])],
      selectedAtTurn: turnNo,
      lastUsedTurn: existing?.lastUsedTurn,
      expiresAfterTurn: nextState === 'pinned'
        ? undefined
        : nextState === 'used'
          ? existing?.state === 'used'
            ? existing.expiresAfterTurn
            : turnNo + 3
          : turnNo + 1,
    });
  }

  return {
    ...state,
    turnNo,
    manifestRevision: input.manifestRevision,
    lastRemoteRouteTurn: input.remoteSearched ? turnNo : state.lastRemoteRouteTurn,
    lastQuery: input.query,
    skills: [...bySlug.values()],
    pendingTurns: {
      ...state.pendingTurns,
      [input.runId]: {
        runId: input.runId,
        turnNo,
        taskFingerprint: input.taskFingerprint,
        selectedSlugs,
        usedSlugs: [],
        status: 'running',
      },
    },
  };
}

export function markSessionSkillUsed(
  state: SessionSkillState,
  runId: string,
  rawSlug: string,
): SessionSkillState {
  const slug = normalizeSlug(rawSlug);
  const pending = state.pendingTurns[runId];
  if (!pending || !pending.selectedSlugs.includes(slug) || pending.usedSlugs.includes(slug)) return state;
  const skills = state.skills.map((lease) => lease.slug === slug
    ? {
        ...lease,
        state: lease.state === 'pinned' ? 'pinned' as const : 'used' as const,
        lastUsedTurn: pending.turnNo,
        expiresAfterTurn: lease.state === 'pinned' ? undefined : pending.turnNo + 3,
      }
    : lease);
  return {
    ...state,
    skills,
    pendingTurns: {
      ...state.pendingTurns,
      [runId]: { ...pending, usedSlugs: [...pending.usedSlugs, slug] },
    },
  };
}

export function finishSessionSkillTurn(
  state: SessionSkillState,
  runId: string,
  success: boolean,
  taskFingerprint?: string,
): SessionSkillState {
  const pending = state.pendingTurns[runId];
  if (!pending) return state;
  const pendingTurns = { ...state.pendingTurns };
  delete pendingTurns[runId];
  const used = new Set(success ? pending.usedSlugs : []);
  const skills = state.skills.map((lease) => {
    if (!pending.selectedSlugs.includes(lease.slug) || lease.state === 'pinned') return lease;
    if (used.has(lease.slug)) {
      return { ...lease, state: 'used' as const, lastUsedTurn: pending.turnNo, expiresAfterTurn: pending.turnNo + 3 };
    }
    if (lease.state === 'used' && lease.lastUsedTurn !== pending.turnNo) return lease;
    return { ...lease, state: 'selected' as const, expiresAfterTurn: pending.turnNo + 1 };
  });
  return {
    ...state,
    skills,
    pendingTurns,
    lastTaskFingerprint: success
      ? taskFingerprint ?? pending.taskFingerprint ?? state.lastTaskFingerprint
      : state.lastTaskFingerprint,
  };
}

export function orderSessionSkillLeases(skills: SessionSkillLease[]): SessionSkillLease[] {
  const priority: Record<SessionSkillLeaseState, number> = { pinned: 3, used: 2, selected: 1 };
  return [...skills].sort((left, right) => (
    priority[right.state] - priority[left.state]
    || (right.lastUsedTurn ?? -1) - (left.lastUsedTurn ?? -1)
    || right.score - left.score
    || right.selectedAtTurn - left.selectedAtTurn
    || left.slug.localeCompare(right.slug)
  ));
}
