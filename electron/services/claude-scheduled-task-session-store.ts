import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getClaudeScheduledTasksDir } from '../utils/paths';
import type {
  ClaudeScheduledTaskDefinition,
  ClaudeScheduledTaskRunRecord,
} from './claude-scheduled-task-store';

const CURRENT_SESSION_VERSION = 1;

export interface ClaudeScheduledTaskSessionListItem {
  key: string;
  label: string;
  sessionFile: string;
  updatedAt?: number;
  engineType: 'claude';
  displayName?: string;
}

export interface ClaudeScheduledTaskSessionMessage {
  id: string;
  role: 'assistant' | 'system';
  content: string;
  timestamp: number;
}

interface SessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  label?: string;
}

interface SessionStore {
  sessions?: Array<{
    key?: string;
    sessionKey?: string;
    sessionId?: string;
    sessionFile?: string;
    label?: string;
  }>;
  [sessionKey: string]: unknown;
}

function getTaskSessionsDir(taskId: string): string {
  return join(getClaudeScheduledTasksDir(), 'sessions', taskId);
}

function getTaskSessionsStorePath(taskId: string): string {
  return join(getTaskSessionsDir(taskId), 'sessions.json');
}

export function buildClaudeTaskSummarySessionKey(taskId: string): string {
  return `claude-task:${taskId}`;
}

export function buildClaudeTaskRunSessionKey(taskId: string, runId: string): string {
  return `claude-task-run:${taskId}:${runId}`;
}

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmpPath, filePath);
}

async function readSessionStore(taskId: string): Promise<SessionStore> {
  try {
    const raw = await readFile(getTaskSessionsStorePath(taskId), 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw) as SessionStore;
  } catch {
    return {};
  }
}

async function writeSessionStore(taskId: string, store: SessionStore): Promise<void> {
  await writeJsonAtomic(getTaskSessionsStorePath(taskId), store);
}

function findSessionEntry(store: SessionStore, sessionKey: string): SessionStoreEntry | null {
  const direct = store[sessionKey];
  if (direct && typeof direct === 'object') {
    const entry = direct as Record<string, unknown>;
    if (typeof entry.sessionId === 'string' && typeof entry.sessionFile === 'string') {
      return {
        sessionId: entry.sessionId,
        sessionFile: entry.sessionFile,
        label: typeof entry.label === 'string' ? entry.label : undefined,
      };
    }
  }

  if (Array.isArray(store.sessions)) {
    const entry = store.sessions.find((item) => item.key === sessionKey || item.sessionKey === sessionKey);
    if (entry?.sessionId && entry.sessionFile) {
      return {
        sessionId: entry.sessionId,
        sessionFile: entry.sessionFile,
        label: entry.label,
      };
    }
  }

  return null;
}

async function createSummarySessionEntry(
  taskId: string,
  sessionKey: string,
  taskName: string,
): Promise<SessionStoreEntry> {
  const sessionId = randomUUID();
  const sessionFile = join(getTaskSessionsDir(taskId), `${sessionId}.jsonl`);
  const header = {
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };

  await ensureParentDir(sessionFile);
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

  const store = await readSessionStore(taskId);
  const entry: SessionStoreEntry = {
    sessionId,
    sessionFile,
    label: taskName,
  };
  store[sessionKey] = entry;
  await writeSessionStore(taskId, store);
  return entry;
}

async function ensureSummarySession(
  definition: ClaudeScheduledTaskDefinition,
): Promise<SessionStoreEntry> {
  const sessionKey = buildClaudeTaskSummarySessionKey(definition.id);
  const store = await readSessionStore(definition.id);
  const existing = findSessionEntry(store, sessionKey);
  if (existing) {
    try {
      await access(existing.sessionFile);
      return existing;
    } catch {
      // Recreate if the jsonl file is missing.
    }
  }
  return createSummarySessionEntry(definition.id, sessionKey, definition.name);
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function formatRunSummary(run: ClaudeScheduledTaskRunRecord): string {
  if (run.summary?.trim()) return run.summary.trim();
  if (run.error?.trim()) return `执行失败：${run.error.trim()}`;
  switch (run.status) {
    case 'succeeded':
      return '任务执行完成（无摘要输出）';
    case 'timed_out':
      return '任务执行超时';
    case 'cancelled':
      return '任务已取消';
    case 'failed':
      return '任务执行失败';
    default:
      return `任务状态：${run.status}`;
  }
}

function formatRunMeta(run: ClaudeScheduledTaskRunRecord): string {
  const lines = [
    `status: ${run.status}`,
    `trigger: ${run.triggerSource}`,
    `scheduledFor: ${run.scheduledFor}`,
    `runId: ${run.runId}`,
  ];
  if (run.completedAt) {
    lines.push(`completedAt: ${run.completedAt}`);
  }
  if (run.runtimeResult?.stopReason) {
    lines.push(`stopReason: ${run.runtimeResult.stopReason}`);
  }
  if (typeof run.runtimeResult?.durationMs === 'number') {
    lines.push(`durationMs: ${run.runtimeResult.durationMs}`);
  }
  if (run.sessionKey) {
    lines.push(`sessionKey: ${run.sessionKey}`);
  }
  return lines.join('\n');
}

export async function appendClaudeScheduledTaskSummaryRun(
  definition: ClaudeScheduledTaskDefinition,
  run: ClaudeScheduledTaskRunRecord,
): Promise<void> {
  const session = await ensureSummarySession(definition);
  const now = run.completedAt ?? run.startedAt ?? new Date().toISOString();
  const lines = [
    JSON.stringify({
      type: 'message',
      timestamp: now,
      message: {
        role: 'assistant',
        content: formatRunSummary(run),
      },
    }),
    JSON.stringify({
      type: 'message',
      timestamp: now,
      message: {
        role: 'system',
        content: formatRunMeta(run),
      },
    }),
  ];
  await appendFile(session.sessionFile, `${lines.join('\n')}\n`, 'utf8');
}

export async function listClaudeScheduledTaskSummarySessions(): Promise<ClaudeScheduledTaskSessionListItem[]> {
  const sessionsRoot = join(getClaudeScheduledTasksDir(), 'sessions');
  const { stat } = await import('node:fs/promises');
  const items: ClaudeScheduledTaskSessionListItem[] = [];

  let taskIds: string[] = [];
  try {
    taskIds = await readdir(sessionsRoot);
  } catch {
    return [];
  }

  for (const taskId of taskIds) {
    const sessionKey = buildClaudeTaskSummarySessionKey(taskId);
    const store = await readSessionStore(taskId);
    const entry = findSessionEntry(store, sessionKey);
    if (!entry) continue;

    let updatedAt: number | undefined;
    try {
      updatedAt = (await stat(entry.sessionFile)).mtimeMs;
    } catch {
      // Ignore missing file metadata.
    }

    items.push({
      key: sessionKey,
      label: entry.label || `Claude 定时任务 ${taskId}`,
      displayName: entry.label || `Claude 定时任务 ${taskId}`,
      sessionFile: entry.sessionFile,
      updatedAt,
      engineType: 'claude',
    });
  }

  items.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  return items;
}

export async function readClaudeScheduledTaskSessionHistory(
  sessionKey: string,
  limit = 100,
): Promise<ClaudeScheduledTaskSessionMessage[]> {
  if (!sessionKey.startsWith('claude-task:')) {
    return [];
  }

  const taskId = sessionKey.slice('claude-task:'.length);
  if (!taskId) return [];

  const store = await readSessionStore(taskId);
  const entry = findSessionEntry(store, sessionKey);
  if (!entry) return [];

  let raw = '';
  try {
    raw = await readFile(entry.sessionFile, 'utf8');
  } catch {
    return [];
  }

  const messages: ClaudeScheduledTaskSessionMessage[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (record.type !== 'message') continue;
      const message = record.message as Record<string, unknown> | undefined;
      const role = message?.role;
      const content = message?.content;
      if ((role !== 'assistant' && role !== 'system') || typeof content !== 'string' || !content.trim()) {
        continue;
      }
      messages.push({
        id: `claude-task-summary-${taskId}-${i}`,
        role,
        content,
        timestamp: normalizeTimestamp(record.timestamp) ?? Date.now(),
      });
    } catch {
      // Ignore malformed lines.
    }
  }

  messages.sort((left, right) => left.timestamp - right.timestamp);
  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? Math.min(messages.length, Math.floor(limit)) : messages.length;
  return messages.slice(-effectiveLimit);
}

export async function deleteClaudeScheduledTaskSummarySession(sessionKey: string): Promise<void> {
  if (!sessionKey.startsWith('claude-task:')) {
    throw new Error(`Unsupported Claude scheduled task session key: ${sessionKey}`);
  }

  const taskId = sessionKey.slice('claude-task:'.length);
  if (!taskId) {
    throw new Error(`Invalid Claude scheduled task session key: ${sessionKey}`);
  }

  const store = await readSessionStore(taskId);
  const entry = findSessionEntry(store, sessionKey);
  if (!entry) {
    return;
  }

  try {
    await access(entry.sessionFile);
    const deletedPath = entry.sessionFile.replace(/\.jsonl$/, '.deleted.jsonl');
    await rename(entry.sessionFile, deletedPath);
  } catch {
    // Non-fatal: still remove store mapping.
  }

  delete store[sessionKey];
  if (Array.isArray(store.sessions)) {
    store.sessions = store.sessions.filter((item) => item.key !== sessionKey && item.sessionKey !== sessionKey);
  }
  await writeSessionStore(taskId, store);
}
