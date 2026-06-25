/**
 * Scheduled Task Session Writer
 *
 * Manages local session creation and appends scheduled task trigger execution
 * results as messages to the corresponding session transcript (.jsonl).
 *
 * Session key format: scheduled-task:{taskId}
 * Also writes to OpenClaw agent session for gateway lookup.
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, appendFile, access, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from '../utils/paths';
import { logger } from '../utils/logger';
import { filterDeletedSessions } from '../utils/scheduled-task-poller-store';
import { reviveScheduledTaskAgentDatedExecutionSession } from '../utils/revive-deleted-execution-session';

const CURRENT_SESSION_VERSION = 1;

/**
 * OpenClaw agent session writer for gateway lookup
 */
function getAgentSessionsJsonPath(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
}

function getAgentSessionsDir(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
}

interface AgentSessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  label?: string;
  [key: string]: unknown;
}

interface AgentSessionStore {
  sessions?: Array<{ key?: string; sessionKey?: string; sessionFile?: string; sessionId?: string; label?: string; [key: string]: unknown }>;
  [sessionKey: string]: unknown;
}

async function readAgentSessionStore(agentId: string): Promise<AgentSessionStore> {
  const storePath = getAgentSessionsJsonPath(agentId);
  try {
    const raw = await readFile(storePath, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as AgentSessionStore;
  } catch {
    return {};
  }
}

async function writeAgentSessionStore(agentId: string, store: AgentSessionStore): Promise<void> {
  const storePath = getAgentSessionsJsonPath(agentId);
  await mkdir(getAgentSessionsDir(agentId), { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

/**
 * Create a session entry in the OpenClaw agent session store for gateway lookup
 */
async function createAgentSessionEntry(
  agentId: string,
  sessionKey: string,
  label: string,
): Promise<AgentSessionStoreEntry> {
  const sessionId = randomUUID();
  const sessionFile = join(getAgentSessionsDir(agentId), `${sessionId}.jsonl`);

  // Write session header to jsonl
  const header = {
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await mkdir(getAgentSessionsDir(agentId), { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

  // Register in sessions.json
  const store = await readAgentSessionStore(agentId);
  const entry: AgentSessionStoreEntry = { sessionId, sessionFile, label };
  store[sessionKey] = entry;
  await writeAgentSessionStore(agentId, store);

  logger.info(`[ScheduledTaskSessionWriter] Created agent session ${sessionKey} -> ${sessionFile}`);
  return entry;
}

/**
 * Append a message to an OpenClaw agent session
 */
async function appendMessageToAgentSession(
  agentId: string,
  sessionKey: string,
  label: string,
  message: { role: string; content: string },
): Promise<void> {
  const store = await readAgentSessionStore(agentId);
  let entry = store[sessionKey] as AgentSessionStoreEntry | undefined;
  
  if (!entry || typeof entry !== 'object' || !entry.sessionFile) {
    entry = await createAgentSessionEntry(agentId, sessionKey, label);
  }

  const messageLine = {
    type: 'message',
    timestamp: new Date().toISOString(),
    message,
  };
  
  await appendFile(entry.sessionFile, `${JSON.stringify(messageLine)}\n`, 'utf8');
  logger.info(`[ScheduledTaskSessionWriter] Appended message to agent session ${sessionKey}`);
}

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
 * Format current date as YYYY-MM-DD string
 */
function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Append a trigger execution result to the task's session transcript.
 * Also writes to OpenClaw agent session for gateway lookup.
 */
export async function appendTriggerResultToSession(
  taskId: number,
  taskName: string,
  run: TriggerRunResult,
): Promise<void> {
  const session = await ensureSession(taskId, taskName);

  // Also write to OpenClaw agent session for gateway lookup
  const entryId = formatLocalYmd(new Date());
  const agentId = 'main';
  const agentSessionKey = `agent:${agentId}:scheduled-task:${taskId}:${entryId}`;

  await reviveScheduledTaskAgentDatedExecutionSession(taskId, agentId, entryId);

  const executionContent = run.executionResult?.trim() || `任务执行完成 (状态：${run.status})`;
  await appendMessageToAgentSession(
    agentId,
    agentSessionKey,
    `${taskName} - ${entryId}`,
    { role: 'assistant', content: executionContent },
  );

  const lines: string[] = [];
  const now = new Date().toISOString();

  // Append execution result as assistant message
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
 * Supports both:
 *   - scheduled-task:{taskId}  (summary session)
 *   - agent:{agentId}:scheduled-task:{taskId}:{date}  (dated agent session)
 */
export async function readScheduledTaskSessionHistory(
  sessionKey: string,
  limit = 100,
): Promise<ScheduledTaskSessionMessage[]> {
  let sessionFile: string | undefined;
  let taskId: number | undefined;

  // Case 1: scheduled-task:{taskId} — read from scheduled-tasks local store
  if (sessionKey.startsWith('scheduled-task:')) {
    const taskIdStr = sessionKey.slice('scheduled-task:'.length);
    taskId = Number(taskIdStr);
    if (Number.isNaN(taskId)) {
      return [];
    }

    const store = await readSessionStore(taskId);
    const entry = findSessionEntry(store, sessionKey);
    if (!entry) {
      return [];
    }
    sessionFile = entry.sessionFile;
  }
  // Case 2: agent:{agentId}:scheduled-task:{taskId}:{date} — read from agent sessions store
  else if (sessionKey.startsWith('agent:')) {
    const parts = sessionKey.split(':');
    // agent:{agentId}:scheduled-task:{taskId}:{date}
    if (parts.length === 5 && parts[2] === 'scheduled-task') {
      const agentId = parts[1] || 'main';
      taskId = Number(parts[3]);
      if (Number.isNaN(taskId)) {
        return [];
      }

      const store = await readAgentSessionStore(agentId);
      const entry = findAgentSessionEntry(store, sessionKey);
      if (!entry) {
        return [];
      }
      sessionFile = entry.sessionFile;
    }
  }

  if (!sessionFile || taskId === undefined) {
    return [];
  }

  // Read the jsonl file
  let raw: string;
  try {
    raw = await readFile(sessionFile, 'utf8');
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

/**
 * Find an agent session entry in the agent session store.
 */
function findAgentSessionEntry(store: AgentSessionStore, sessionKey: string): AgentSessionStoreEntry | undefined {
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

// ---------------------------------------------------------------------------
// List all scheduled task sessions
// ---------------------------------------------------------------------------

export interface ScheduledTaskSessionListItem {
  key: string;
  label: string;
  displayName?: string;
  sessionFile: string;
  updatedAt?: number;
}

function resolveScheduledTaskDisplayName(
  label: string | undefined,
  sessionKey: string,
): string | undefined {
  if (!label || label === sessionKey) return undefined;
  const head = label.split(' - ')[0]?.trim();
  if (head && head !== sessionKey && !head.startsWith('agent:')) return head;
  if (!label.startsWith('agent:') && !label.startsWith('scheduled-task:')) {
    return label.trim();
  }
  return undefined;
}

function isScheduledTaskAgentSessionKey(sessionKey: string): boolean {
  if (!sessionKey.startsWith('agent:')) return false;
  const parts = sessionKey.split(':');
  if (parts.length !== 5 || parts[2] !== 'scheduled-task') return false;
  const taskId = Number(parts[3]);
  const date = parts[4];
  return !Number.isNaN(taskId) && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

export async function listAllScheduledTaskSessions(): Promise<ScheduledTaskSessionListItem[]> {
  const sessions: ScheduledTaskSessionListItem[] = [];
  const { stat } = await import('node:fs/promises');

  // 1) Summary sessions under scheduled-tasks/{taskId}/
  const baseDir = join(getOpenClawConfigDir(), 'scheduled-tasks');
  try {
    const taskDirs = await readdir(baseDir);
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

      let updatedAt: number | undefined;
      try {
        const s = await stat(entry.sessionFile);
        updatedAt = s.mtimeMs;
      } catch {
        // ignore
      }

      sessions.push({
        key: sessionKey,
        label: entry.label || `定时任务 ${taskId}`,
        displayName: entry.label || `定时任务 ${taskId}`,
        sessionFile: entry.sessionFile,
        updatedAt,
      });
    }
  } catch {
    // ignore
  }

  // 2) Dated agent sessions (agent:main:scheduled-task:{taskId}:{date}) from agents/main/sessions/sessions.json
  try {
    const agentStore = await readAgentSessionStore('main');
    const candidates: Array<{ key: string; record: Record<string, unknown> }> = [];

    for (const [key, value] of Object.entries(agentStore)) {
      if (key === 'sessions') continue;
      if (value && typeof value === 'object') {
        candidates.push({ key, record: value as Record<string, unknown> });
      }
    }

    if (Array.isArray(agentStore.sessions)) {
      for (const s of agentStore.sessions) {
        if (!s || typeof s !== 'object') continue;
        const record = s as Record<string, unknown>;
        const key = (record.key || record.sessionKey) as string | undefined;
        if (!key) continue;
        candidates.push({ key, record });
      }
    }

    for (const { key, record } of candidates) {
      if (!isScheduledTaskAgentSessionKey(key)) continue;

      const sessionFile =
        (record.sessionFile ?? record.file ?? record.fileName ?? record.path) as string | undefined;
      if (!sessionFile) continue;

      let updatedAt: number | undefined;
      try {
        const s = await stat(sessionFile);
        updatedAt = s.mtimeMs;
      } catch {
        // ignore
      }

      const rawLabel = typeof record.label === 'string' ? record.label : undefined;
      sessions.push({
        key,
        label: rawLabel ?? key,
        displayName: resolveScheduledTaskDisplayName(rawLabel, key),
        sessionFile,
        updatedAt,
      });
    }
  } catch {
    // ignore
  }

  // Sort by most recently updated first
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return filterDeletedSessions(sessions);
}
