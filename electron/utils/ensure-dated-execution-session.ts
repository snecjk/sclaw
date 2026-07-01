import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import { formatLocalYmdFromMs } from '../../shared/first-trigger-placeholder-session-key';

export { formatLocalYmdFromMs } from '../../shared/first-trigger-placeholder-session-key';

const CURRENT_SESSION_VERSION = 1;

function getSessionsJsonPath(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
}

function getSessionsDir(agentId: string): string {
  return join(getOpenClawConfigDir(), 'agents', agentId, 'sessions');
}

export function formatLocalYmd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface SessionStoreEntry {
  sessionId: string;
  sessionFile: string;
  label?: string;
}

interface SessionStore {
  sessions?: Array<{ key?: string; sessionKey?: string; sessionFile?: string; sessionId?: string; label?: string }>;
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
  await mkdir(getSessionsDir(agentId), { recursive: true });
  await writeFile(getSessionsJsonPath(agentId), JSON.stringify(store, null, 2), 'utf8');
}

function findSessionEntry(store: SessionStore, sessionKey: string): SessionStoreEntry | undefined {
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

  if (Array.isArray(store.sessions)) {
    const arrayEntry = store.sessions.find(
      (session) => session.key === sessionKey || session.sessionKey === sessionKey,
    );
    if (
      arrayEntry
      && typeof arrayEntry.sessionFile === 'string'
      && typeof arrayEntry.sessionId === 'string'
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

async function createAgentSessionEntry(
  agentId: string,
  sessionKey: string,
  label?: string,
): Promise<SessionStoreEntry> {
  const sessionsDir = getSessionsDir(agentId);
  const sessionId = randomUUID();
  const sessionFile = join(sessionsDir, `${sessionId}.jsonl`);
  const header = {
    type: 'session',
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
  };
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(sessionFile, `${JSON.stringify(header)}\n`, 'utf8');

  const store = await readSessionStore(agentId);
  const entry: SessionStoreEntry = {
    sessionId,
    sessionFile,
    ...(label?.trim() ? { label: label.trim() } : {}),
  };
  store[sessionKey] = entry;
  await writeSessionStore(agentId, store);

  logger.info(`[ensure-dated-execution-session] Created ${sessionKey} -> ${sessionFile}`);
  return entry;
}

/** Ensure a physical dated agent session exists so sidebar survives page refresh. */
export async function ensureAgentDatedSessionPlaceholder(
  agentId: string,
  sessionKey: string,
  label?: string,
): Promise<void> {
  const trimmedKey = sessionKey.trim();
  if (!trimmedKey.startsWith('agent:')) return;

  const store = await readSessionStore(agentId);
  const existing = findSessionEntry(store, trimmedKey);
  if (existing) {
    try {
      await access(existing.sessionFile);
      return;
    } catch {
      logger.warn(`[ensure-dated-execution-session] Recreating missing file for ${trimmedKey}`);
    }
  }
  await createAgentSessionEntry(agentId, trimmedKey, label);
}

export async function ensureCronDatedExecutionSessionPlaceholder(
  jobId: string,
  agentId = 'main',
  options?: { date?: string; label?: string },
): Promise<void> {
  const date = options?.date ?? formatLocalYmd();
  const sessionKey = `agent:${agentId}:cron:${jobId}:${date}`;
  await ensureAgentDatedSessionPlaceholder(agentId, sessionKey, options?.label);
}

export type FirstTriggeredSessionPlaceholder = {
  key: string;
  label: string;
  displayName?: string;
  updatedAt: number;
};

/** Supplement cron session list from persisted group first-trigger timestamps. */
export function buildFirstTriggeredCronSessionPlaceholders(
  firstTriggered: Record<string, number>,
  existingKeys: ReadonlySet<string>,
  jobNamesById: Map<string, string>,
  agentId = 'main',
): FirstTriggeredSessionPlaceholder[] {
  const items: FirstTriggeredSessionPlaceholder[] = [];
  for (const [groupKey, atMs] of Object.entries(firstTriggered)) {
    if (!groupKey.startsWith('cron:') || !(atMs > 0)) continue;
    const jobId = groupKey.slice('cron:'.length).trim();
    if (!jobId) continue;
    const date = formatLocalYmdFromMs(atMs);
    const sessionKey = `agent:${agentId}:cron:${jobId}:${date}`;
    if (existingKeys.has(sessionKey)) continue;
    const name = jobNamesById.get(jobId);
    items.push({
      key: sessionKey,
      label: name ? `Cron: ${name}` : sessionKey,
      displayName: name,
      updatedAt: atMs,
    });
  }
  return items;
}

/** Supplement Claude dated sessions from persisted group first-trigger timestamps. */
export function buildFirstTriggeredClaudeSessionPlaceholders(
  firstTriggered: Record<string, number>,
  existingKeys: ReadonlySet<string>,
  taskNamesById: Map<string, string>,
): Array<FirstTriggeredSessionPlaceholder & { engineType: 'claude' }> {
  const items: Array<FirstTriggeredSessionPlaceholder & { engineType: 'claude' }> = [];
  for (const [groupKey, atMs] of Object.entries(firstTriggered)) {
    if (!groupKey.startsWith('claude-task:') || !(atMs > 0)) continue;
    const taskId = groupKey.slice('claude-task:'.length).trim();
    if (!taskId) continue;
    const date = formatLocalYmdFromMs(atMs);
    const sessionKey = `claude-task:${taskId}:${date}`;
    if (existingKeys.has(sessionKey)) continue;
    const name = taskNamesById.get(taskId);
    items.push({
      key: sessionKey,
      label: name ? `Claude 定时任务 ${name}` : `Claude 定时任务 ${taskId}`,
      displayName: name,
      updatedAt: atMs,
      engineType: 'claude',
    });
  }
  return items;
}
