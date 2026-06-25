import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getClaudeScheduledTasksDir } from '../utils/paths';

export type ClaudeTaskPermissionProfile =
  | 'readonly-safe'
  | 'workspace-write'
  | 'dangerous-bypass';

export interface ClaudeScheduledTaskDefinition {
  id: string;
  name: string;
  enabled: boolean;
  cronExpr: string;
  promptTemplate: string;
  agentId: string;
  workspacePath: string;
  providerAccountId?: string;
  model?: string;
  permissionProfile: ClaudeTaskPermissionProfile;
  timeoutSec: number;
  workflowCode?: string;
  retryPolicy: {
    maxAttempts: number;
    backoffSec: number;
  };
  failurePolicy: {
    pauseAfterConsecutiveFailures: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ClaudeScheduledTaskSchedulerState {
  lastTickAt?: string;
  tasks: Record<string, {
    nextRunAt?: string;
    lastScheduledFor?: string;
    lastRecoveredAt?: string;
  }>;
}

export interface ClaudeScheduledTaskLease {
  taskId: string;
  runId: string;
  leaseUntil: string;
}

export interface ClaudeScheduledTaskRunRecord {
  runId: string;
  taskId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';
  triggerSource: 'manual' | 'schedule' | 'recovery';
  scheduledFor: string;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  idempotencyKey: string;
  sessionKey: string;
  summary?: string;
  error?: string;
  runtimeResult?: {
    stopReason?: string | null;
    isError?: boolean;
    durationMs?: number;
  };
  runtimeSnapshot: {
    workspacePath: string;
    providerAccountId?: string;
    model?: string;
    permissionProfile: string;
    pluginPaths: string[];
  };
}

interface ClaudeScheduledTaskDefinitionsDocument {
  definitions?: ClaudeScheduledTaskDefinition[];
}

const DEFINITIONS_FILE = join(getClaudeScheduledTasksDir(), 'definitions.json');
const SCHEDULER_STATE_FILE = join(getClaudeScheduledTasksDir(), 'scheduler-state.json');
const LEASES_FILE = join(getClaudeScheduledTasksDir(), 'leases.json');

let mutationQueue: Promise<void> = Promise.resolve();

async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(tmpPath, filePath);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function runMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(mutation);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function getTaskRunsFile(taskId: string): string {
  return join(getClaudeScheduledTasksDir(), 'runs', `${taskId}.jsonl`);
}

export async function listClaudeScheduledTaskDefinitions(): Promise<ClaudeScheduledTaskDefinition[]> {
  const doc = await readJsonFile<ClaudeScheduledTaskDefinitionsDocument>(DEFINITIONS_FILE, {});
  return Array.isArray(doc.definitions) ? doc.definitions : [];
}

export async function getClaudeScheduledTaskDefinition(
  taskId: string,
): Promise<ClaudeScheduledTaskDefinition | null> {
  const definitions = await listClaudeScheduledTaskDefinitions();
  return definitions.find((item) => item.id === taskId) ?? null;
}

export async function upsertClaudeScheduledTaskDefinition(
  definition: ClaudeScheduledTaskDefinition,
): Promise<void> {
  await runMutation(async () => {
    const doc = await readJsonFile<ClaudeScheduledTaskDefinitionsDocument>(DEFINITIONS_FILE, {});
    const definitions = Array.isArray(doc.definitions) ? [...doc.definitions] : [];
    const index = definitions.findIndex((item) => item.id === definition.id);
    if (index >= 0) {
      definitions[index] = definition;
    } else {
      definitions.push(definition);
    }
    await writeJsonAtomic(DEFINITIONS_FILE, { definitions });
  });
}

export async function deleteClaudeScheduledTaskDefinition(
  taskId: string,
): Promise<ClaudeScheduledTaskDefinition | null> {
  return runMutation(async () => {
    const doc = await readJsonFile<ClaudeScheduledTaskDefinitionsDocument>(DEFINITIONS_FILE, {});
    const definitions = Array.isArray(doc.definitions) ? [...doc.definitions] : [];
    const index = definitions.findIndex((item) => item.id === taskId);
    if (index < 0) return null;
    const [removed] = definitions.splice(index, 1);
    await writeJsonAtomic(DEFINITIONS_FILE, { definitions });
    return removed ?? null;
  });
}

export async function readClaudeScheduledTaskSchedulerState(): Promise<ClaudeScheduledTaskSchedulerState> {
  return readJsonFile<ClaudeScheduledTaskSchedulerState>(SCHEDULER_STATE_FILE, { tasks: {} });
}

export async function writeClaudeScheduledTaskSchedulerState(
  state: ClaudeScheduledTaskSchedulerState,
): Promise<void> {
  await runMutation(async () => {
    await writeJsonAtomic(SCHEDULER_STATE_FILE, {
      lastTickAt: state.lastTickAt,
      tasks: state.tasks ?? {},
    });
  });
}

export async function listClaudeScheduledTaskLeases(): Promise<ClaudeScheduledTaskLease[]> {
  return readJsonFile<ClaudeScheduledTaskLease[]>(LEASES_FILE, []);
}

export async function getClaudeScheduledTaskLease(
  taskId: string,
): Promise<ClaudeScheduledTaskLease | null> {
  const leases = await listClaudeScheduledTaskLeases();
  return leases.find((lease) => lease.taskId === taskId) ?? null;
}

export async function upsertClaudeScheduledTaskLease(
  lease: ClaudeScheduledTaskLease,
): Promise<void> {
  await runMutation(async () => {
    const leases = await readJsonFile<ClaudeScheduledTaskLease[]>(LEASES_FILE, []);
    const next = [...leases];
    const index = next.findIndex((item) => item.taskId === lease.taskId);
    if (index >= 0) {
      next[index] = lease;
    } else {
      next.push(lease);
    }
    await writeJsonAtomic(LEASES_FILE, next);
  });
}

export async function deleteClaudeScheduledTaskLease(taskId: string): Promise<void> {
  await runMutation(async () => {
    const leases = await readJsonFile<ClaudeScheduledTaskLease[]>(LEASES_FILE, []);
    await writeJsonAtomic(
      LEASES_FILE,
      leases.filter((item) => item.taskId !== taskId),
    );
  });
}

export async function appendClaudeScheduledTaskRunRecord(
  record: ClaudeScheduledTaskRunRecord,
): Promise<void> {
  const filePath = getTaskRunsFile(record.taskId);
  await ensureParentDir(filePath);
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function listClaudeScheduledTaskRunRecords(
  taskId: string,
  limit?: number,
): Promise<ClaudeScheduledTaskRunRecord[]> {
  const filePath = getTaskRunsFile(taskId);
  let raw = '';
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const records: ClaudeScheduledTaskRunRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as ClaudeScheduledTaskRunRecord);
    } catch {
      // Ignore malformed lines so a single bad record does not break history.
    }
  }

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return records.slice(-Math.floor(limit));
  }
  return records;
}

export async function getLatestClaudeScheduledTaskRunRecord(
  taskId: string,
): Promise<ClaudeScheduledTaskRunRecord | null> {
  const records = await listClaudeScheduledTaskRunRecords(taskId, 1);
  return records[0] ?? null;
}
