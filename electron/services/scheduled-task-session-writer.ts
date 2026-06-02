/**
 * Scheduled Task Session Writer
 *
 * Manages local session creation and appends scheduled task trigger execution
 * results as messages to the corresponding session transcript (.jsonl).
 *
 * Session key format: scheduled-task:{taskId}
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, appendFile, access, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';

const CURRENT_SESSION_VERSION = 1;

function getSessionsJsonPath(taskId: number): string {
  return join(getOpenClawConfigDir(), 'scheduled-tasks', String(taskId), 'sessions', 'sessions.json');
}

function getSessionsDir(taskId: number): string {
  return join(getOpenClawConfigDir(), 'scheduled-tasks', String(taskId), 'sessions');
}

export function buildScheduledTaskSessionKey(taskId: number): string {
  return `scheduled-task:${taskId}`;
}

export interface SessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  label?: string;
  [key: string]: unknown;
}

interface SessionStore {
  sessions?: Array<{ key?: string; sessionKey?: string; sessionFile?: string; sessionId?: string; label?: string; [key: string]: unknown }>;
  [sessionKey: string]: unknown;
}

async function readSessionStore(taskId: number): Promise<SessionStore> {
  const storePath = getSessionsJsonPath(taskId);
  try {
    const raw = await readFile(storePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

async function writeSessionStore(taskId: number, store: SessionStore): Promise<void> {
  const storePath = getSessionsJsonPath(taskId);
  await mkdir(getSessionsDir(taskId), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

function findSessionEntry(store: SessionStore, sessionKey: string): SessionStoreEntry | undefined {
  // Direct key lookup
  const direct = store[sessionKey];
  if (direct && typeof direct === 'object' && direct !== null) {
    const entry = direct as Record<string, unknown>;
    if (typeof entry.sessionFile === 'string' && typeof entry.sessionId === 'string') {
      return {
        sessionId: entry.sessionId,
        sessionFile: entry.sessionFile,
        label: typeof entry.label === 'string' ? entry.label : undefined,
      };
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
      return {
        sessionId: arrayEntry.sessionId,
        sessionFile: arrayEntry.sessionFile,
        label: typeof arrayEntry.label === 'string' ? arrayEntry.label : undefined,
      };
    }
  }

  return undefined;
}

async function createSessionEntry(
  taskId: number,
  sessionKey: string,
  taskName: string,
): Promise<SessionStoreEntry> {
  const sessionId = randomUUID();
  const sessionFile = join(getSessionsDir(taskId), `${sessionId}.jsonl`);

  // Write session header to jsonl
  const header = {
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await mkdir(getSessionsDir(taskId), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

  // Register in sessions.json
  const store = await readSessionStore(taskId);
  const entry: SessionStoreEntry = { sessionId, sessionFile, label: taskName };

  // Prefer direct key format
  store[sessionKey] = entry;
  await writeSessionStore(taskId, store);

  logger.info(`[ScheduledTaskSessionWriter] Created session ${sessionKey} -> ${sessionFile}`);
  return entry;
}

/**
 * Ensure a session exists for the given task. Creates one if missing.
 */
export async function ensureSession(
  taskId: number,
  taskName: string,
): Promise<SessionStoreEntry> {
  const sessionKey = buildScheduledTaskSessionKey(taskId);
  const store = await readSessionStore(taskId);
  const existing = findSessionEntry(store, sessionKey);
  if (existing) {
    // Verify the jsonl file still exists
    try {
      await access(existing.sessionFile);
      return existing;
    } catch {
      // File missing, recreate
      logger.warn(`[ScheduledTaskSessionWriter] Session file missing for ${sessionKey}, recreating`);
    }
  }
  return createSessionEntry(taskId, sessionKey, taskName);
}

export interface TriggerRunResult {
  status: string;
  executionResult?: string;
  logText?: string;
}

/**
 * Append a trigger execution result to the task's session transcript.
 */
export async function appendTriggerResultToSession(
  taskId: number,
  taskName: string,
  run: TriggerRunResult,
): Promise<void> {
  const session = await ensureSession(taskId, taskName);

  const lines: string[] = [];
  const now = new Date().toISOString();

  // Append execution result as assistant message
  const executionContent = run.executionResult?.trim() ?? '';
  if (executionContent) {
    const messageLine = {
      type: 'message',
      timestamp: now,
      message: {
        role: 'assistant',
        content: executionContent,
      },
    };
    lines.push(JSON.stringify(messageLine));
  } else if (run.status !== 'pending') {
    // No execution result and not pending - record a placeholder
    const messageLine = {
      type: 'message',
      timestamp: now,
      message: {
        role: 'assistant',
        content: `执行完成（无输出内容）\n\n状态：${run.status}`,
      },
    };
    lines.push(JSON.stringify(messageLine));
  }

  // Append log text as system message
  const logContent = run.logText?.trim() ?? '';
  if (logContent) {
    const logLine = {
      type: 'message',
      timestamp: now,
      message: {
        role: 'system',
        content: logContent,
      },
    };
    lines.push(JSON.stringify(logLine));
  }

  if (lines.length > 0) {
    await appendFile(session.sessionFile, `${lines.join('\n')}\n`, 'utf8');
    logger.info(
      `[ScheduledTaskSessionWriter] Appended ${lines.length} messages to session ${session.sessionFile}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Session History Reading
// ---------------------------------------------------------------------------

export interface ScheduledTaskSessionMessage {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Read session history for a given scheduled task session key.
 */
export async function readScheduledTaskSessionHistory(
  sessionKey: string,
  limit = 100,
): Promise<ScheduledTaskSessionMessage[]> {
  if (!sessionKey.startsWith('scheduled-task:')) {
    return [];
  }

  const taskIdStr = sessionKey.slice('scheduled-task:'.length);
  const taskId = Number(taskIdStr);
  if (Number.isNaN(taskId)) {
    return [];
  }

  const store = await readSessionStore(taskId);
  const entry = findSessionEntry(store, sessionKey);
  if (!entry) {
    return [];
  }

  // Read the jsonl file
  let raw: string;
  try {
    raw = await readFile(entry.sessionFile, 'utf8');
  } catch {
    return [];
  }

  const messages: ScheduledTaskSessionMessage[] = [];
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (record.type !== 'message') continue;

      const msg = record.message as Record<string, unknown> | undefined;
      if (!msg) continue;

      const role = msg.role as string | undefined;
      const content = msg.content as string | undefined;
      if (!role || !content) continue;

      const ts = normalizeTimestamp(record.timestamp) ?? Date.now();

      messages.push({
        id: `st-msg-${taskId}-${i}`,
        role: role === 'system' ? 'system' : 'assistant',
        content,
        timestamp: ts,
      });
    } catch {
      // Ignore malformed lines
    }
  }

  // Sort chronologically and apply limit
  messages.sort((a, b) => a.timestamp - b.timestamp);
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, messages.length) : messages.length;
  return messages.slice(-effectiveLimit);
}

// ---------------------------------------------------------------------------
// List all scheduled task sessions
// ---------------------------------------------------------------------------

export interface ScheduledTaskSessionListItem {
  key: string;
  label: string;
  sessionFile: string;
  updatedAt?: number;
}

export async function listAllScheduledTaskSessions(): Promise<ScheduledTaskSessionListItem[]> {
  const baseDir = join(getOpenClawConfigDir(), 'scheduled-tasks');
  const sessions: ScheduledTaskSessionListItem[] = [];

  let taskDirs: string[];
  try {
    taskDirs = await readdir(baseDir);
  } catch {
    return sessions;
  }

  for (const taskDir of taskDirs) {
    const taskId = Number(taskDir);
    if (Number.isNaN(taskId)) continue;

    const storePath = getSessionsJsonPath(taskId);
    let store: SessionStore;
    try {
      const raw = await readFile(storePath, 'utf8');
      if (!raw.trim()) continue;
      store = JSON.parse(raw) as SessionStore;
    } catch {
      continue;
    }

    const sessionKey = buildScheduledTaskSessionKey(taskId);
    const entry = findSessionEntry(store, sessionKey);
    if (!entry) continue;

    // Try to get the last modified time of the session file for sorting
    let updatedAt: number | undefined;
    try {
      const { stat } = await import('node:fs/promises');
      const s = await stat(entry.sessionFile);
      updatedAt = s.mtimeMs;
    } catch {
      // ignore
    }

    sessions.push({
      key: sessionKey,
      label: entry.label || `定时任务 ${taskId}`,
      sessionFile: entry.sessionFile,
      updatedAt,
    });
  }

  // Sort by most recently updated first
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return sessions;
}
