import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface RuntimeSkillCandidate {
  slug: string;
  sourceHash: string;
  skillRoot: string;
  skillMdPath: string;
}

export interface RuntimeSkillReadMatch {
  candidate: RuntimeSkillCandidate;
  resolvedPath: string;
}

interface RuntimeSkillCandidateSet {
  runId?: string;
  expiresAt: number;
  items: RuntimeSkillCandidate[];
}

const CANDIDATE_TTL_MS = 30 * 60 * 1000;
const candidatesBySession = new Map<string, RuntimeSkillCandidateSet>();
const activeRunBySession = new Map<string, string>();

function pathInside(root: string, target: string): boolean {
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const child = relative(normalizedRoot, normalizedTarget);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

export function beginRuntimeSkillAccessTurn(sessionKey: string, runId?: string): void {
  candidatesBySession.delete(sessionKey);
  if (runId) activeRunBySession.set(sessionKey, runId);
  else activeRunBySession.delete(sessionKey);
}

export function clearRuntimeSkillAccess(sessionKey: string): void {
  candidatesBySession.delete(sessionKey);
  activeRunBySession.delete(sessionKey);
}

export function registerRuntimeSkillCandidates(
  sessionKey: string,
  runId: string | undefined,
  items: readonly RuntimeSkillCandidate[],
): void {
  candidatesBySession.set(sessionKey, {
    runId,
    expiresAt: Date.now() + CANDIDATE_TTL_MS,
    items: [...items],
  });
}

export async function findRuntimeSkillCandidateForRead(input: {
  sessionKey: string;
  runId?: string;
  requestedPath: string;
  cwd?: string;
}): Promise<RuntimeSkillReadMatch | undefined> {
  const set = candidatesBySession.get(input.sessionKey);
  if (!set || set.expiresAt < Date.now()) {
    candidatesBySession.delete(input.sessionKey);
    return undefined;
  }
  const expectedRunId = input.runId ?? activeRunBySession.get(input.sessionKey);
  if (set.runId && set.runId !== expectedRunId) return undefined;
  try {
    const absolute = isAbsolute(input.requestedPath)
      ? input.requestedPath
      : resolve(input.cwd ?? process.cwd(), input.requestedPath);
    const target = await realpath(absolute);
    for (const item of set.items) {
      const root = await realpath(item.skillRoot);
      if (pathInside(root, target)) return { candidate: item, resolvedPath: target };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
