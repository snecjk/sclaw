/** Cleanup for the transient Gateway sessions used by workflow smart nodes. */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { isWorkflowOpenClawSessionKey } from '../../../shared/workflow-openclaw-session';

function sessionFiles(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const entry = value as Record<string, unknown>;
  return ['sessionFile', 'file', 'fileName', 'path']
    .map((key) => entry[key])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function safeSessionFilePath(sessionsDir: string, candidate: string): string | null {
  const target = path.resolve(sessionsDir, candidate);
  const relative = path.relative(path.resolve(sessionsDir), target);
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : target;
}

/**
 * Remove a workflow-only Gateway transcript and its sessions.json registry
 * entry. This intentionally deletes rather than soft-deletes: workflow audit
 * is stored in wf_* tables, never in ordinary chat history.
 */
export async function cleanupWorkflowOpenClawSession(
  sessionKey: string,
  options?: { sessionsDir?: string },
): Promise<{ removed: boolean; transcriptCount: number }> {
  if (!isWorkflowOpenClawSessionKey(sessionKey)) {
    throw new Error(`Refusing to clean a non-workflow OpenClaw session: ${sessionKey}`);
  }
  const sessionsDir = options?.sessionsDir ?? path.join(getOpenClawConfigDir(), 'agents', 'workflow-runtime', 'sessions');
  const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');
  let raw: string;
  try {
    raw = await readFile(sessionsJsonPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: false, transcriptCount: 0 };
    throw error;
  }
  const store = JSON.parse(raw) as Record<string, unknown>;
  const entries: unknown[] = [];
  if (Array.isArray(store.sessions)) {
    entries.push(...store.sessions.filter((item) => {
      const entry = item as Record<string, unknown>;
      return entry?.key === sessionKey || entry?.sessionKey === sessionKey;
    }));
    store.sessions = store.sessions.filter((item) => {
      const entry = item as Record<string, unknown>;
      return entry?.key !== sessionKey && entry?.sessionKey !== sessionKey;
    });
  }
  if (store[sessionKey] != null) {
    entries.push(store[sessionKey]);
    delete store[sessionKey];
  }
  if (entries.length === 0) return { removed: false, transcriptCount: 0 };

  const transcriptPaths = [...new Set(entries.flatMap(sessionFiles)
    .map((candidate) => safeSessionFilePath(sessionsDir, candidate))
    .filter((candidate): candidate is string => candidate !== null))];
  await Promise.all(transcriptPaths.map((filePath) => rm(filePath, { force: true })));
  await writeFile(sessionsJsonPath, JSON.stringify(store, null, 2), 'utf8');
  return { removed: true, transcriptCount: transcriptPaths.length };
}

/** Remove abandoned workflow transcripts left by an interrupted older run. */
export async function cleanupStaleWorkflowOpenClawSessions(options?: { sessionsDir?: string }): Promise<number> {
  const sessionsDir = options?.sessionsDir ?? path.join(getOpenClawConfigDir(), 'agents', 'workflow-runtime', 'sessions');
  let store: Record<string, unknown>;
  try {
    store = JSON.parse(await readFile(path.join(sessionsDir, 'sessions.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const keys = new Set<string>();
  if (Array.isArray(store.sessions)) {
    for (const item of store.sessions) {
      const entry = item as Record<string, unknown>;
      const key = typeof entry?.key === 'string' ? entry.key : typeof entry?.sessionKey === 'string' ? entry.sessionKey : '';
      if (isWorkflowOpenClawSessionKey(key)) keys.add(key);
    }
  }
  for (const key of Object.keys(store)) {
    if (isWorkflowOpenClawSessionKey(key)) keys.add(key);
  }
  for (const key of keys) await cleanupWorkflowOpenClawSession(key, { sessionsDir });
  return keys.size;
}
