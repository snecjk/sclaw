import { join } from 'node:path';
import { getOpenClawConfigDir } from './paths';
import { deleteEngineSessionRegistryEntry } from '../engines/session-registry';
import { logger } from './logger';

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
}

function runEntryLocalYmd(entry: CronRunLogEntry): string | undefined {
  const ts = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!ts) return undefined;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function softDeleteJsonlIfExists(filePath: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  try {
    await fsP.access(filePath);
    const dstPath = filePath.replace(/\.jsonl$/, '.deleted.jsonl');
    await fsP.rename(filePath, dstPath);
  } catch {
    // ignore
  }
}

async function cleanupAgentSessionsJson(sessionKey: string): Promise<boolean> {
  if (!sessionKey.startsWith('agent:')) return false;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return false;
  const agentId = parts[1];
  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const fsP = await import('node:fs/promises');

  let raw: string;
  try {
    raw = await fsP.readFile(sessionsJsonPath, 'utf8');
  } catch {
    return false;
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }

  let removed = false;
  if (Array.isArray(json.sessions)) {
    const sessionsArr = json.sessions as Array<Record<string, unknown>>;
    const before = sessionsArr.length;
    json.sessions = sessionsArr.filter((s) => s.key !== sessionKey && s.sessionKey !== sessionKey);
    if ((json.sessions as unknown[]).length !== before) removed = true;
  }
  if (json[sessionKey] != null) {
    delete json[sessionKey];
    removed = true;
  }

  if (removed) {
    await fsP.writeFile(sessionsJsonPath, JSON.stringify(json, null, 2), 'utf8');
  }
  return removed;
}

async function resetAgentOpenClawSession(agentId: string, sessionKey: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  const sessionsJsonPath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  let sessionFile: string | undefined;
  try {
    const raw = await fsP.readFile(sessionsJsonPath, 'utf8');
    const json = JSON.parse(raw) as Record<string, unknown>;
    const direct = json[sessionKey];
    if (direct && typeof direct === 'object') {
      sessionFile = (direct as Record<string, unknown>).sessionFile as string | undefined;
    }
    if (!sessionFile && Array.isArray(json.sessions)) {
      const entry = (json.sessions as Array<Record<string, unknown>>).find(
        (s) => s.key === sessionKey || s.sessionKey === sessionKey,
      );
      sessionFile = entry?.sessionFile as string | undefined;
    }
  } catch {
    // ignore
  }

  await cleanupAgentSessionsJson(sessionKey);
  if (sessionFile) {
    await softDeleteJsonlIfExists(sessionFile);
  }
  await deleteEngineSessionRegistryEntry(sessionKey).catch(() => {});
}

async function purgeCronRunLogForDate(jobId: string, date: string): Promise<void> {
  const fsP = await import('node:fs/promises');
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await fsP.readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return;

  const kept: string[] = [];
  const relatedSessionKeys = new Set<string>();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (entry.jobId && entry.jobId !== jobId) {
        kept.push(trimmed);
        continue;
      }
      if (entry.action && entry.action !== 'finished') {
        kept.push(trimmed);
        continue;
      }
      const entryDate = runEntryLocalYmd(entry);
      if (entryDate === date) {
        if (typeof entry.sessionKey === 'string' && entry.sessionKey.trim()) {
          relatedSessionKeys.add(entry.sessionKey.trim());
        }
        if (typeof entry.sessionId === 'string' && entry.sessionId.trim()) {
          relatedSessionKeys.add(`agent:main:cron:${jobId}:run:${entry.sessionId.trim()}`);
        }
        continue;
      }
      kept.push(trimmed);
    } catch {
      kept.push(trimmed);
    }
  }

  await fsP.writeFile(logPath, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf8');

  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  const agentIds = await fsP.readdir(agentsDir).catch(() => [] as string[]);
  for (const agentId of agentIds) {
    await resetAgentOpenClawSession(agentId, `agent:${agentId}:cron:${jobId}:${date}`);
  }
  for (const sessionKey of relatedSessionKeys) {
    if (!sessionKey.startsWith('agent:')) continue;
    const agentId = sessionKey.split(':')[1];
    if (!agentId) continue;
    await resetAgentOpenClawSession(agentId, sessionKey);
  }
}

async function resetCronDatedExecutionRecord(agentId: string, jobId: string, date: string): Promise<void> {
  await purgeCronRunLogForDate(jobId, date);
  await resetAgentOpenClawSession(agentId, `agent:${agentId}:cron:${jobId}:${date}`);
}

async function resetClaudeTaskDatedExecutionRecord(taskId: string, date: string): Promise<void> {
  const { deleteClaudeSessionByKey } = await import('../engines/claude-adapter');
  await deleteClaudeSessionByKey(`claude-task:${taskId}:${date}`);
}

/** Clear same-day execution artifacts so a revived record only contains the next run. */
export async function resetDatedExecutionArtifacts(sessionKey: string): Promise<void> {
  const cronDated = sessionKey.match(/^agent:([^:]+):cron:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (cronDated) {
    await resetCronDatedExecutionRecord(cronDated[1], cronDated[2], cronDated[3]);
    return;
  }

  const claudeDated = sessionKey.match(/^claude-task:([^:]+):(\d{4}-\d{2}-\d{2})$/);
  if (claudeDated) {
    await resetClaudeTaskDatedExecutionRecord(claudeDated[1], claudeDated[2]);
    return;
  }

  logger.warn(`[resetDatedExecutionArtifacts] Unsupported session key: ${sessionKey}`);
}
