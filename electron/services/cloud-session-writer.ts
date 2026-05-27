/**
 * Cloud Session Writer
 *
 * Manages cron cloud session creation and appends cloud execution results
 * as assistant messages to the corresponding session transcript (.jsonl).
 *
 * Session key format: agent:{cloudAgentId}:cron:{cloudJobId}
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, appendFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import type { CloudTaskResult } from '../shared/cloud-cron';

const CURRENT_SESSION_VERSION = 1;

function getSessionsJsonPath(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
}

function getSessionsDir(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
}

function buildSessionKey(agentId: string, jobId: string): string {
  return `agent:${agentId}:cron:${jobId}`;
}

interface SessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  [key: string]: unknown;
}

interface SessionStore {
  sessions?: Array<{ key?: string; sessionKey?: string; sessionFile?: string; sessionId?: string; [key: string]: unknown }>;
  [sessionKey: string]: unknown;
}

async function readSessionStore(agentId: string): Promise<SessionStore> {
  const storePath = getSessionsJsonPath(agentId);
  try {
    const raw = await readFile(storePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

async function writeSessionStore(agentId: string, store: SessionStore): Promise<void> {
  const storePath = getSessionsJsonPath(agentId);
  await mkdir(getSessionsDir(agentId), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

function findSessionEntry(store: SessionStore, sessionKey: string): SessionStoreEntry | undefined {
  // Direct key lookup
  const direct = store[sessionKey];
  if (direct && typeof direct === 'object' && direct !== null) {
    const entry = direct as Record<string, unknown>;
    if (typeof entry.sessionFile === 'string' && typeof entry.sessionId === 'string') {
      return { sessionId: entry.sessionId, sessionFile: entry.sessionFile };
    }
  }

  // Array lookup
  if (Array.isArray(store.sessions)) {
    const arrayEntry = store.sessions.find(
      (s) => s.key === sessionKey || s.sessionKey === sessionKey,
    );
    if (
      arrayEntry &&
      typeof arrayEntry.sessionFile === 'string' &&
      typeof arrayEntry.sessionId === 'string'
    ) {
      return { sessionId: arrayEntry.sessionId, sessionFile: arrayEntry.sessionFile };
    }
  }

  return undefined;
}

async function createSessionEntry(agentId: string, sessionKey: string): Promise<SessionStoreEntry> {
  const sessionId = randomUUID();
  const sessionFile = join(getSessionsDir(agentId), `${sessionId}.jsonl`);

  // Write session header to jsonl
  const header = {
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await mkdir(getSessionsDir(agentId), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

  // Register in sessions.json
  const store = await readSessionStore(agentId);
  const entry: SessionStoreEntry = { sessionId, sessionFile };

  // Prefer direct key format (same as OpenClaw Gateway)
  store[sessionKey] = entry;
  await writeSessionStore(agentId, store);

  logger.info(`[CloudSessionWriter] Created session ${sessionKey} -> ${sessionFile}`);
  return entry;
}

async function ensureSession(agentId: string, jobId: string): Promise<SessionStoreEntry> {
  const sessionKey = buildSessionKey(agentId, jobId);
  const store = await readSessionStore(agentId);
  const existing = findSessionEntry(store, sessionKey);
  if (existing) {
    // Verify the jsonl file still exists
    try {
      await access(existing.sessionFile);
      return existing;
    } catch {
      // File missing, recreate
      logger.warn(`[CloudSessionWriter] Session file missing for ${sessionKey}, recreating`);
    }
  }
  return createSessionEntry(agentId, sessionKey);
}

/**
 * Append a cloud execution result as an assistant message to the session transcript.
 */
export async function appendCloudResultToSession(
  agentId: string,
  jobId: string,
  result: CloudTaskResult,
): Promise<void> {
  const session = await ensureSession(agentId, jobId);

  const content = result.output?.message ?? '';
  if (!content && result.status !== 'failure') {
    logger.warn(`[CloudSessionWriter] Empty output for result ${result.id}, skipping session append`);
    return;
  }

  const messageLine = {
    type: 'message',
    timestamp: new Date(result.completedAt).toISOString(),
    message: {
      role: 'assistant',
      content: result.status === 'failure'
        ? `**执行失败**\n\n${result.error?.message ?? '未知错误'}`
        : content,
      model: result.model ?? undefined,
      usage: result.output?.usage
        ? {
            input: result.output.usage.inputTokens,
            output: result.output.usage.outputTokens,
          }
        : undefined,
    },
  };

  await appendFile(session.sessionFile, `${JSON.stringify(messageLine)}\n`, 'utf8');
  logger.info(`[CloudSessionWriter] Appended result ${result.id} to session ${session.sessionFile}`);
}

/**
 * Append multiple cloud execution results to their respective sessions.
 * Results are grouped by (agentId, jobId) and written in batch.
 */
export async function appendCloudResultsToSessions(
  results: CloudTaskResult[],
): Promise<void> {
  if (!results.length) return;

  // Group by agentId + jobId
  const groups = new Map<string, { agentId: string; jobId: string; results: CloudTaskResult[] }>();

  for (const result of results) {
    // CloudTaskResult may carry agentId; fallback to lookup via taskId if missing
    const agentId = (result as unknown as Record<string, unknown>).agentId as string | undefined;
    if (!agentId) {
      logger.warn(`[CloudSessionWriter] Result ${result.id} missing agentId, skipping session append`);
      continue;
    }
    const key = `${agentId}:${result.taskId}`;
    const group = groups.get(key);
    if (group) {
      group.results.push(result);
    } else {
      groups.set(key, { agentId, jobId: result.taskId, results: [result] });
    }
  }

  for (const { agentId, jobId, results: groupResults } of groups.values()) {
    const session = await ensureSession(agentId, jobId);
    const lines: string[] = [];

    for (const result of groupResults) {
      const content = result.output?.message ?? '';
      if (!content && result.status !== 'failure') continue;

      const messageLine = {
        type: 'message',
        timestamp: new Date(result.completedAt).toISOString(),
        message: {
          role: 'assistant',
          content: result.status === 'failure'
            ? `**执行失败**\n\n${result.error?.message ?? '未知错误'}`
            : content,
          model: result.model ?? undefined,
          usage: result.output?.usage
            ? {
                input: result.output.usage.inputTokens,
                output: result.output.usage.outputTokens,
              }
            : undefined,
        },
      };
      lines.push(JSON.stringify(messageLine));
    }

    if (lines.length > 0) {
      await appendFile(session.sessionFile, `${lines.join('\n')}\n`, 'utf8');
      logger.info(
        `[CloudSessionWriter] Appended ${lines.length} results to session ${session.sessionFile}`,
      );
    }
  }
}
