import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'http';
import { join } from 'node:path';
import { CHAT_HISTORY_LIMIT } from '../../../shared/chat-config';
import { hasResolvedDingTalkMentions } from '../../../shared/dingtalk-mention-context';
import { prepareDingTalkAgentTurnMessage } from '../../../shared/dingtalk-recipient-message';
import type { DingTalkMention } from '../../../shared/dingtalk-mention';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getOpenClawConfigDir } from '../../utils/paths';
import { filterDeletedSessions, listDeletedSessionKeys } from '../../utils/scheduled-task-poller-store';
import { reviveCronDatedExecutionSession } from '../../utils/revive-deleted-execution-session';
import {
  buildFirstTriggeredCronSessionPlaceholders,
  ensureCronDatedExecutionSessionPlaceholder,
} from '../../utils/ensure-dated-execution-session';
import { ensureTaskGroupFirstTriggeredOnRun, listTaskGroupFirstTriggeredAt } from '../../utils/task-group-first-trigger-store';
import { cronTaskGroupKey } from '../../../shared/task-group-key';

interface GatewayCronJob {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: { kind: string; expr?: string; everyMs?: number; at?: string; tz?: string };
  payload: { kind: string; message?: string; text?: string };
  delivery?: { mode: string; channel?: string; to?: string };
  sessionTarget?: string;
  state: {
    nextRunAtMs?: number;
    runningAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
  };
}

interface CronRunLogEntry {
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  ts?: number;
  runAtMs?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
}

interface CronSessionKeyParts {
  agentId: string;
  jobId: string;
  runSessionId?: string;
  date?: string;
}

interface CronSessionFallbackMessage {
  id: string;
  role: 'assistant' | 'system' | 'user' | 'toolresult' | 'tool_result';
  content: string | unknown[];
  timestamp: number;
  isError?: boolean;
  toolCallId?: string;
  toolName?: string;
}

function parseCronSessionKey(sessionKey: string): CronSessionKeyParts | null {
  if (!sessionKey.startsWith('agent:')) return null;
  const parts = sessionKey.split(':');
  if (parts.length < 4 || parts[2] !== 'cron') return null;

  const agentId = parts[1] || 'main';
  const jobId = parts[3];
  if (!jobId) return null;

  if (parts.length === 4) {
    return { agentId, jobId };
  }

  if (parts.length === 5) {
    const date = parts[4];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { agentId, jobId, date };
    }
    return { agentId, jobId };
  }

  if (parts.length === 6 && parts[4] === 'run' && parts[5]) {
    return { agentId, jobId, runSessionId: parts[5] };
  }

  return null;
}

function normalizeTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Read full conversation messages from a cron run session jsonl file.
 * The sessionKey format is: agent:{agentId}:cron:{jobId}:run:{runSessionId}
 */
async function readRunSessionMessages(sessionKey: string): Promise<CronSessionFallbackMessage[]> {
  const parsed = parseCronSessionKey(sessionKey);
  if (!parsed || !parsed.runSessionId) return [];

  const sessionFile = join(getOpenClawConfigDir(), 'agents', parsed.agentId, 'sessions', `${parsed.runSessionId}.jsonl`);

  let raw: string;
  try {
    raw = await readFile(sessionFile, 'utf8');
  } catch {
    return [];
  }

  const messages: CronSessionFallbackMessage[] = [];
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
      const content = msg.content as string | unknown[] | undefined;
      if (!role || content == null) continue;

      const normalizedRole = role.toLowerCase();
      const timestamp = normalizeTimestampMs(record.timestamp) ?? Date.now();

      // Preserve tool_result rows so the renderer can absorb workflow_execution_started.
      if (normalizedRole === 'toolresult' || normalizedRole === 'tool_result') {
        messages.push({
          id: `cron-run-msg-${parsed.runSessionId}-${i}`,
          role: normalizedRole === 'tool_result' ? 'tool_result' : 'toolresult',
          content,
          timestamp,
          toolCallId: typeof msg.toolCallId === 'string' ? msg.toolCallId : undefined,
          toolName: typeof msg.toolName === 'string' ? msg.toolName : undefined,
        });
        continue;
      }

      if (normalizedRole === 'user') {
        let textContent = '';
        if (typeof content === 'string') {
          textContent = content;
        } else if (Array.isArray(content)) {
          textContent = content
            .filter((c: unknown) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text')
            .map((c: unknown) => (c as Record<string, unknown>).text as string)
            .filter(Boolean)
            .join('');
        }
        if (!textContent) continue;
        messages.push({
          id: `cron-run-msg-${parsed.runSessionId}-${i}`,
          role: 'user',
          content: textContent,
          timestamp,
        });
        continue;
      }

      // Handle content format: string or array of text blocks
      let textContent = '';
      if (typeof content === 'string') {
        textContent = content;
      } else if (Array.isArray(content)) {
        textContent = content
          .filter((c: unknown) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text')
          .map((c: unknown) => (c as Record<string, unknown>).text as string)
          .filter(Boolean)
          .join('');
      }

      if (!textContent) continue;

      messages.push({
        id: `cron-run-msg-${parsed.runSessionId}-${i}`,
        role: role === 'user' ? 'user' : role === 'system' ? 'system' : 'assistant',
        content: textContent,
        timestamp,
      });
    } catch {
      // Ignore malformed lines
    }
  }

  return messages;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (!durationMs || !Number.isFinite(durationMs)) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 1000)}s`;
}

function buildCronRunMessage(entry: CronRunLogEntry, index: number): CronSessionFallbackMessage | null {
  const timestamp = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
  if (!timestamp) return null;

  const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
  const summary = typeof entry.summary === 'string' ? entry.summary.trim() : '';
  const error = typeof entry.error === 'string' ? entry.error.trim() : '';
  let content = summary || error;

  if (!content) {
    content = status === 'error'
      ? 'Scheduled task failed.'
      : 'Scheduled task completed.';
  }

  if (status === 'error' && !content.toLowerCase().startsWith('run failed:')) {
    content = `Run failed: ${content}`;
  }

  const meta: string[] = [];
  const duration = formatDuration(entry.durationMs);
  if (duration) meta.push(`Duration: ${duration}`);
  if (entry.provider && entry.model) {
    meta.push(`Model: ${entry.provider}/${entry.model}`);
  } else if (entry.model) {
    meta.push(`Model: ${entry.model}`);
  }
  if (meta.length > 0) {
    content = `${content}\n\n${meta.join(' | ')}`;
  }

  return {
    id: `cron-run-${entry.sessionId ?? entry.ts ?? index}`,
    role: status === 'error' ? 'system' : 'assistant',
    content,
    timestamp,
    ...(status === 'error' ? { isError: true } : {}),
  };
}

async function readCronRunLog(jobId: string): Promise<CronRunLogEntry[]> {
  const logPath = join(getOpenClawConfigDir(), 'cron', 'runs', `${jobId}.jsonl`);
  const raw = await readFile(logPath, 'utf8').catch(() => '');
  if (!raw.trim()) return [];

  const entries: CronRunLogEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CronRunLogEntry;
      if (!entry || entry.jobId !== jobId) continue;
      if (entry.action && entry.action !== 'finished') continue;
      entries.push(entry);
    } catch {
      // Ignore malformed log lines so one bad entry does not hide the rest.
    }
  }
  return entries;
}

async function readSessionStoreEntry(
  agentId: string,
  sessionKey: string,
): Promise<Record<string, unknown> | undefined> {
  const storePath = join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', 'sessions.json');
  const raw = await readFile(storePath, 'utf8').catch(() => '');
  if (!raw.trim()) return undefined;

  try {
    const store = JSON.parse(raw) as Record<string, unknown>;
    const directEntry = store[sessionKey];
    if (directEntry && typeof directEntry === 'object') {
      return directEntry as Record<string, unknown>;
    }

    const sessions = (store as { sessions?: unknown }).sessions;
    if (Array.isArray(sessions)) {
      const arrayEntry = sessions.find((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const record = entry as Record<string, unknown>;
        return record.key === sessionKey || record.sessionKey === sessionKey;
      });
      if (arrayEntry && typeof arrayEntry === 'object') {
        return arrayEntry as Record<string, unknown>;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

interface CronSessionListItem {
  key: string;
  label: string;
  displayName?: string;
  updatedAt?: number;
}

async function listAllCronSessions(): Promise<CronSessionListItem[]> {
  const sessions: CronSessionListItem[] = [];
  const { stat, readdir, readFile: fsReadFile } = await import('node:fs/promises');

  const jobNamesById = new Map<string, string>();
  try {
    const jobsFile = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
    const jobsRaw = await readFile(jobsFile, 'utf8');
    const jobsData = JSON.parse(jobsRaw) as { jobs?: Array<{ id: string; name?: string }> };
    for (const job of jobsData.jobs ?? []) {
      if (job.id && job.name?.trim()) jobNamesById.set(job.id, job.name.trim());
    }
  } catch {
    // ignore
  }

  // 1) Scan agents/*/sessions/sessions.json for physical dated sessions
  const agentsDir = join(getOpenClawConfigDir(), 'agents');
  try {
    const agentIds = await readdir(agentsDir);
    for (const agentId of agentIds) {
      const storePath = join(agentsDir, agentId, 'sessions', 'sessions.json');
      let store: Record<string, unknown>;
      try {
        const raw = await readFile(storePath, 'utf8');
        if (!raw.trim()) continue;
        store = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }

      const entries: Array<{ key: string; record: Record<string, unknown> }> = [];

      for (const [key, value] of Object.entries(store)) {
        if (key === 'sessions') continue;
        if (value && typeof value === 'object') {
          entries.push({ key, record: value as Record<string, unknown> });
        }
      }

      if (Array.isArray(store.sessions)) {
        for (const s of store.sessions) {
          if (!s || typeof s !== 'object') continue;
          const record = s as Record<string, unknown>;
          const key = (record.key || record.sessionKey) as string | undefined;
          if (!key) continue;
          entries.push({ key, record });
        }
      }

      for (const { key, record } of entries) {
        const parsed = parseCronSessionKey(key);
        if (!parsed || !parsed.date) continue;
        const sessionFile = (record.sessionFile ?? record.file ?? record.fileName ?? record.path) as string | undefined;
        if (!sessionFile) continue;

        let updatedAt: number | undefined;
        try {
          const s = await stat(sessionFile);
          updatedAt = s.mtimeMs;
        } catch {
          // ignore
        }

        const rawLabel = typeof record.label === 'string' ? record.label : undefined;
        const jobId = parsed.jobId;
        sessions.push({
          key,
          label: rawLabel ?? key,
          displayName: jobNamesById.get(jobId),
          updatedAt,
        });
      }
    }
  } catch {
    // ignore
  }

  // 2) Generate virtual dated sessions from cron run logs for local cron jobs
  // Read base session labels from sessions.json
  const baseSessionLabels = new Map<string, string>();
  try {
    const sessionsFile = join(getOpenClawConfigDir(), 'agents', 'main', 'sessions', 'sessions.json');
    const sessionsRaw = await readFile(sessionsFile, 'utf8');
    const sessionsData = JSON.parse(sessionsRaw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(sessionsData)) {
      if (key === 'sessions' || !value || typeof value !== 'object') continue;
      const record = value as Record<string, unknown>;
      if (typeof record.label === 'string') {
        baseSessionLabels.set(key, record.label);
      }
    }
  } catch {
    // ignore
  }

  const runsDir = join(getOpenClawConfigDir(), 'cron', 'runs');
  try {
    const runFiles = await readdir(runsDir);
    for (const file of runFiles) {
      if (!file.endsWith('.jsonl')) continue;
      const jobId = file.slice(0, -6); // remove '.jsonl'

      const raw = await fsReadFile(join(runsDir, file), 'utf8').catch(() => '');
      if (!raw.trim()) continue;

      const runsByDate = new Map<string, number>(); // date -> latest timestamp
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as CronRunLogEntry;
          if (entry.jobId !== jobId) continue;
          if (entry.action && entry.action !== 'finished') continue;

          const ts = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
          if (!ts) continue;

          const d = new Date(ts);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          runsByDate.set(date, Math.max(runsByDate.get(date) ?? 0, ts));
        } catch {
          // ignore malformed lines
        }
      }

      for (const [date, updatedAt] of runsByDate) {
        const sessionKey = `agent:main:cron:${jobId}:${date}`;
        // Skip if already present from physical sessions scan
        if (sessions.some((s) => s.key === sessionKey)) continue;
        const baseKey = `agent:main:cron:${jobId}`;
        const label = baseSessionLabels.get(baseKey) || `Cron: ${jobId}`;
        sessions.push({
          key: sessionKey,
          label,
          displayName: jobNamesById.get(jobId),
          updatedAt,
        });
      }
    }
  } catch {
    // ignore
  }

  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  const deletedKeys = new Set(await listDeletedSessionKeys());
  const firstTriggered = await listTaskGroupFirstTriggeredAt();
  const existingKeys = new Set(sessions.map((session) => session.key));
  sessions.push(
    ...buildFirstTriggeredCronSessionPlaceholders(firstTriggered, existingKeys, jobNamesById)
      .filter((placeholder) => !deletedKeys.has(placeholder.key)),
  );
  sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return filterDeletedSessions(sessions);
}

export async function buildCronSessionFallbackMessages(params: {
  sessionKey: string;
  job?: Pick<GatewayCronJob, 'name' | 'payload' | 'state'>;
  runs: CronRunLogEntry[];
  sessionEntry?: { label?: string; updatedAt?: number };
  limit?: number;
}): Promise<CronSessionFallbackMessage[]> {
  const parsed = parseCronSessionKey(params.sessionKey);
  if (!parsed) return [];

  const matchingRuns = params.runs
    .filter((entry) => {
      if (parsed.date) {
        const ts = normalizeTimestampMs(entry.ts) ?? normalizeTimestampMs(entry.runAtMs);
        if (!ts) return false;
        const d = new Date(ts);
        const entryDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return entryDate === parsed.date;
      }
      if (!parsed.runSessionId) return true;
      return entry.sessionId === parsed.runSessionId
        || entry.sessionKey === `${params.sessionKey}`;
    })
    .sort((a, b) => {
      const left = normalizeTimestampMs(a.ts) ?? normalizeTimestampMs(a.runAtMs) ?? 0;
      const right = normalizeTimestampMs(b.ts) ?? normalizeTimestampMs(b.runAtMs) ?? 0;
      return left - right;
    });

  const messages: CronSessionFallbackMessage[] = [];
  const prompt = params.job?.payload?.message || params.job?.payload?.text || '';
  const taskName = params.job?.name?.trim()
    || params.sessionEntry?.label?.replace(/^Cron:\s*/, '').trim()
    || '';
  const firstRelevantTimestamp = matchingRuns.length > 0
    ? (normalizeTimestampMs(matchingRuns[0]?.runAtMs) ?? normalizeTimestampMs(matchingRuns[0]?.ts))
    : (normalizeTimestampMs(params.job?.state?.runningAtMs) ?? params.sessionEntry?.updatedAt);

  if (taskName || prompt) {
    const lines = [taskName ? `Scheduled task: ${taskName}` : 'Scheduled task'];
    if (prompt) lines.push(`Prompt: ${prompt}`);
    messages.push({
      id: `cron-meta-${parsed.jobId}`,
      role: 'system',
      content: lines.join('\n'),
      timestamp: Math.max(0, (firstRelevantTimestamp ?? Date.now()) - 1),
    });
  }

  // For each run, prefer the full run-session transcript. The cron run log summary
  // duplicates the assistant reply when a jsonl transcript is available.
  for (const entry of matchingRuns) {
    const runMessages = entry.sessionKey
      ? await readRunSessionMessages(entry.sessionKey)
      : [];
    if (runMessages.length > 0) {
      messages.push(...runMessages);
      continue;
    }

    const message = buildCronRunMessage(entry, matchingRuns.indexOf(entry));
    if (message) messages.push(message);
  }

  if (matchingRuns.length === 0) {
    const runningAt = normalizeTimestampMs(params.job?.state?.runningAtMs);
    if (runningAt) {
      messages.push({
        id: `cron-running-${parsed.jobId}`,
        role: 'system',
        content: 'This scheduled task is still running in OpenClaw, but no chat transcript is available yet.',
        timestamp: runningAt,
      });
    } else if (messages.length === 0) {
      messages.push({
        id: `cron-empty-${parsed.jobId}`,
        role: 'system',
        content: 'No chat transcript is available for this scheduled task yet.',
        timestamp: params.sessionEntry?.updatedAt ?? Date.now(),
      });
    }
  }

  const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
    ? Math.max(1, Math.floor(params.limit))
    : messages.length;
  return messages.slice(-limit);
}

function transformCronJob(job: GatewayCronJob) {
  const message = job.payload?.message || job.payload?.text || '';
  const channelType = job.delivery?.channel;
  const target = channelType
    ? { channelType, channelId: channelType, channelName: channelType }
    : undefined;
  const lastRun = job.state?.lastRunAtMs
    ? {
      time: new Date(job.state.lastRunAtMs).toISOString(),
      success: job.state.lastStatus === 'ok',
      error: job.state.lastError,
      duration: job.state.lastDurationMs,
    }
    : undefined;
  const nextRun = job.state?.nextRunAtMs
    ? new Date(job.state.nextRunAtMs).toISOString()
    : undefined;

  // Extract metadata stored in description JSON (agentId, workflowCode)
  const meta = parseCronDescriptionMeta(job.description);

  return {
    id: job.id,
    name: job.name,
    message,
    schedule: job.schedule,
    target,
    enabled: job.enabled,
    agentId: meta.agentId ?? null,
    workflowCode: meta.workflowCode,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString(),
    lastRun,
    nextRun,
  };
}

interface CronDescriptionMeta {
  agentId?: string;
  dingTalkMentions?: DingTalkMention[];
  workflowCode?: string;
}

/** Extract metadata stored in a job's description field. */
function parseCronDescriptionMeta(description?: string): CronDescriptionMeta {
  if (!description) return {};
  try {
    const meta = JSON.parse(description) as CronDescriptionMeta;
    if (!meta || typeof meta !== 'object') return {};
    return meta;
  } catch {
    return {};
  }
}

/** Extract agentId from the JSON metadata stored in a job's description field. */
function extractAgentIdFromDescription(description?: string): string | null {
  const agentId = parseCronDescriptionMeta(description).agentId;
  return typeof agentId === 'string' && agentId ? agentId : null;
}

function buildCronDescription(
  agentId: string | null,
  mentions?: DingTalkMention[],
  workflowCode?: string,
): string | undefined {
  const meta: CronDescriptionMeta = {};
  if (agentId) meta.agentId = agentId;
  if (hasResolvedDingTalkMentions(mentions)) meta.dingTalkMentions = mentions;
  if (workflowCode) meta.workflowCode = workflowCode;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}

function buildCronMessage(message: string, mentions?: DingTalkMention[]): string {
  return prepareDingTalkAgentTurnMessage(message, mentions);
}

export async function handleCronRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cron/beautify-instruction' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        instruction: string;
        workflowId?: string;
        workflowName?: string;
      }>(req);
      const { beautifyScheduledTaskInstruction } = await import(
        '../../services/scheduled-task-instruction-beautifier'
      );
      const result = await beautifyScheduledTaskInstruction(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/session-history' && req.method === 'GET') {
    const sessionKey = url.searchParams.get('sessionKey')?.trim() || '';
    const parsedSession = parseCronSessionKey(sessionKey);
    if (!parsedSession) {
      sendJson(res, 400, { success: false, error: `Invalid cron sessionKey: ${sessionKey}` });
      return true;
    }

    const rawLimit = Number(url.searchParams.get('limit') || String(CHAT_HISTORY_LIMIT));
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), CHAT_HISTORY_LIMIT)
      : CHAT_HISTORY_LIMIT;

    try {
      const [jobsResult, runs, directSessionEntry] = await Promise.all([
        ctx.gatewayManager.rpc('cron.list', { includeDisabled: true })
          .catch(() => ({ jobs: [] as GatewayCronJob[] })),
        readCronRunLog(parsedSession.jobId),
        readSessionStoreEntry(parsedSession.agentId, sessionKey),
      ]);

      // For virtual dated sessions, fall back to the base cron session entry
      let sessionEntry = directSessionEntry;
      if (!sessionEntry && parsedSession.date) {
        const baseKey = `agent:${parsedSession.agentId}:cron:${parsedSession.jobId}`;
        sessionEntry = await readSessionStoreEntry(parsedSession.agentId, baseKey);
      }

      const jobs = (jobsResult as { jobs?: GatewayCronJob[] }).jobs ?? [];
      const job = jobs.find((item) => item.id === parsedSession.jobId);
      const messages = await buildCronSessionFallbackMessages({
        sessionKey,
        job,
        runs,
        sessionEntry: sessionEntry ? {
          label: typeof sessionEntry.label === 'string' ? sessionEntry.label : undefined,
          updatedAt: normalizeTimestampMs(sessionEntry.updatedAt),
        } : undefined,
        limit,
      });

      sendJson(res, 200, { messages });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/local-job-names' && req.method === 'GET') {
    // Reads cron job names directly from cron/jobs.json (no Gateway dependency).
    // Used as a fallback when /api/cron/jobs (Gateway-backed) is temporarily
    // unavailable — e.g. during a cron trigger race window.
    try {
      const jobsFile = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
      const raw = await readFile(jobsFile, 'utf8');
      const data = JSON.parse(raw) as { jobs?: Array<{ id: string; name?: string }> };
      const jobs = (data.jobs ?? [])
        .filter((j) => j.id && j.name)
        .map((j) => ({ id: j.id, name: j.name! }));
      sendJson(res, 200, jobs);
    } catch {
      sendJson(res, 200, []);
    }
    return true;
  }

  if (url.pathname === '/api/cron/sessions' && req.method === 'GET') {
    try {
      const sessions = await listAllCronSessions(ctx);
      sendJson(res, 200, { sessions });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'GET') {
    try {
      const filterAgentId = url.searchParams.get('agentId')?.trim() || null;
      const result = await ctx.gatewayManager.rpc('cron.list', { includeDisabled: true });
      const data = result as { jobs?: GatewayCronJob[] };
      let jobs = data?.jobs ?? [];
      for (const job of jobs) {
        const isIsolatedAgent =
          (job.sessionTarget === 'isolated' || !job.sessionTarget) &&
          job.payload?.kind === 'systemEvent';
        const needsRepair =
          isIsolatedAgent &&
          job.delivery?.mode === 'announce' &&
          !job.delivery?.channel;
        if (needsRepair) {
          try {
            await ctx.gatewayManager.rpc('cron.update', {
              jobId: job.id,
              patch: { delivery: { mode: 'none' } },
            });
            job.delivery = { mode: 'none' };
            if (job.state?.lastError?.includes('Channel is required')) {
              job.state.lastError = undefined;
              job.state.lastStatus = 'ok';
            }
          } catch {
            // ignore per-job repair failure
          }
        }
      }
      // Filter by agentId when provided (agent detail page)
      if (filterAgentId) {
        jobs = jobs.filter((job) => extractAgentIdFromDescription(job.description) === filterAgentId);
      }
      sendJson(res, 200, jobs.map(transformCronJob));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/jobs' && req.method === 'POST') {
    try {
      const input = await parseJsonBody<{
        name: string;
        message: string;
        schedule: string;
        enabled?: boolean;
        agentId?: string;
        dingTalkMentions?: DingTalkMention[];
        workflowCode?: string;
      }>(req);
      const agentId = input.agentId?.trim() || null;
      const description = buildCronDescription(agentId, input.dingTalkMentions, input.workflowCode);
      const message = buildCronMessage(input.message, input.dingTalkMentions);
      const result = await ctx.gatewayManager.rpc('cron.add', {
        name: input.name,
        schedule: { kind: 'cron', expr: input.schedule },
        payload: { kind: 'agentTurn', message },
        enabled: input.enabled ?? true,
        wakeMode: 'next-heartbeat',
        sessionTarget: 'isolated',
        delivery: { mode: 'none' },
        ...(description ? { description } : {}),
      });
      sendJson(res, 200, result && typeof result === 'object' ? transformCronJob(result as GatewayCronJob) : result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'PUT') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      const input = await parseJsonBody<Record<string, unknown> & {
        message?: string;
        schedule?: string;
        agentId?: string;
        dingTalkMentions?: DingTalkMention[];
        workflowCode?: string;
      }>(req);
      const patch = { ...input };
      if (typeof patch.schedule === 'string') {
        patch.schedule = { kind: 'cron', expr: patch.schedule };
      }
      if (typeof patch.message === 'string') {
        patch.payload = {
          kind: 'agentTurn',
          message: buildCronMessage(patch.message, patch.dingTalkMentions),
        };
        delete patch.message;
      }
      if (patch.dingTalkMentions !== undefined || patch.agentId !== undefined || patch.workflowCode !== undefined) {
        const agentId = typeof patch.agentId === 'string' ? patch.agentId.trim() || null : null;
        const mentions = Array.isArray(patch.dingTalkMentions) ? patch.dingTalkMentions as DingTalkMention[] : undefined;
        const workflowCode = typeof patch.workflowCode === 'string' ? patch.workflowCode : undefined;
        const description = buildCronDescription(agentId, mentions, workflowCode);
        if (description) patch.description = description;
        delete patch.agentId;
        delete patch.dingTalkMentions;
        delete patch.workflowCode;
      }
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { jobId: id, patch }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/cron/jobs/') && req.method === 'DELETE') {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/cron/jobs/'.length));
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.remove', { id }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/toggle' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string; enabled: boolean }>(req);
      sendJson(res, 200, await ctx.gatewayManager.rpc('cron.update', { jobId: body.id, patch: { enabled: body.enabled } }));
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/cron/trigger' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ id: string }>(req);
      const result = await ctx.gatewayManager.rpc('cron.run', { id: body.id, mode: 'force' });
      await reviveCronDatedExecutionSession(body.id, 'main');
      let jobLabel: string | undefined;
      try {
        const jobsFile = join(getOpenClawConfigDir(), 'cron', 'jobs.json');
        const jobsRaw = await readFile(jobsFile, 'utf8');
        const jobsData = JSON.parse(jobsRaw) as { jobs?: Array<{ id: string; name?: string }> };
        const name = jobsData.jobs?.find((job) => job.id === body.id)?.name?.trim();
        if (name) jobLabel = `Cron: ${name}`;
      } catch {
        // ignore
      }
      await ensureCronDatedExecutionSessionPlaceholder(body.id, 'main', { label: jobLabel });
      await ensureTaskGroupFirstTriggeredOnRun(cronTaskGroupKey(body.id));
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
