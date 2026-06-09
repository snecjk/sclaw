/**
 * Workflow Memory Store
 *
 * Persists created workflow metadata to localStorage so that
 * "帮我执行" (help me execute) can recover the workflow even
 * after page refresh or app restart.
 *
 * Storage keys (both scoped by sessionKey):
 * - stoclaw:session-workflows  → Record<sessionKey, WorkflowMemoryRecord[]>
 * - stoclaw:workflow-executions → Record<sessionKey, WorkflowExecutionRecord[]>
 */

export interface WorkflowMemoryRecord {
  workflowId: string;
  templateId: string;
  templateName: string;
  schemaHash: string;
  collectedInputs: Record<string, unknown>;
  createdAt: number; // timestamp
  /** Last run id for re-execution and result lookup */
  lastRunId?: string;
  /** Last known execution status */
  lastStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';
  /** When the workflow last completed (success or failure) */
  completedAt?: number;
}

/**
 * Workflow execution record for SSE state tracking.
 * Stores the complete lifecycle from creation to execution.
 */
export interface WorkflowExecutionRecord {
  sessionKey: string;
  workflowId: string;       // ID returned from createWorkflow
  runId: string;            // ID returned from startWorkflow
  templateId: string;
  templateName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';
  createdAt: number;        // When execution was started
  updatedAt: number;        // Last status update
  collectedInputs: Record<string, unknown>;  // User-filled parameters
}

const STORAGE_KEY = 'stoclaw:session-workflows';
const EXECUTIONS_STORAGE_KEY = 'stoclaw:workflow-executions';
const MAX_RECORDS_PER_SESSION = 20; // prevent unbounded growth
const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function load(): Record<string, WorkflowMemoryRecord[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as Record<string, WorkflowMemoryRecord[]>;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function save(data: Record<string, WorkflowMemoryRecord[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

function pruneExpired(records: WorkflowMemoryRecord[]): WorkflowMemoryRecord[] {
  const now = Date.now();
  return records.filter((r) => now - r.createdAt < RECORD_TTL_MS);
}

/**
 * Update an existing workflow record with run result metadata.
 */
export function updateWorkflowRunMetadata(
  sessionKey: string,
  workflowId: string,
  metadata: Partial<Pick<WorkflowMemoryRecord, 'lastRunId' | 'lastStatus' | 'completedAt'>>,
): void {
  const data = load();
  const sessionRecords = data[sessionKey] || [];
  const idx = sessionRecords.findIndex((r) => r.workflowId === workflowId);
  if (idx >= 0) {
    sessionRecords[idx] = { ...sessionRecords[idx], ...metadata };
    data[sessionKey] = sessionRecords;
    save(data);
  }
}

/**
 * Save a created workflow record to local memory.
 */
export function saveWorkflowRecord(
  sessionKey: string,
  record: WorkflowMemoryRecord,
): void {
  const data = load();
  const sessionRecords = pruneExpired(data[sessionKey] || []);
  sessionRecords.unshift(record); // newest first
  // Cap the number of records
  if (sessionRecords.length > MAX_RECORDS_PER_SESSION) {
    sessionRecords.length = MAX_RECORDS_PER_SESSION;
  }
  data[sessionKey] = sessionRecords;
  save(data);
}

/**
 * Get all remembered workflows for a session.
 * Returns newest first.
 */
export function getSessionWorkflows(
  sessionKey: string,
): WorkflowMemoryRecord[] {
  const data = load();
  return pruneExpired(data[sessionKey] || []);
}

/**
 * Get the most recently created workflow for a session.
 */
export function getLatestWorkflow(
  sessionKey: string,
): WorkflowMemoryRecord | undefined {
  const workflows = getSessionWorkflows(sessionKey);
  return workflows[0];
}

/**
 * Find a workflow by workflowId across all sessions.
 */
export function findWorkflowById(
  workflowId: string,
): { sessionKey: string; record: WorkflowMemoryRecord } | undefined {
  const data = load();
  for (const [sessionKey, records] of Object.entries(data)) {
    const found = records.find((r) => r.workflowId === workflowId);
    if (found) {
      return { sessionKey, record: found };
    }
  }
  return undefined;
}

// ── Workflow Execution Records (session-scoped) ───────────────────────

const MAX_EXECUTIONS_PER_SESSION = 20;
const EXECUTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for active tracking

type ExecutionStore = Record<string, WorkflowExecutionRecord[]>;

/** Legacy flat array before session scoping was added. */
type LegacyExecutionRecord = Omit<WorkflowExecutionRecord, 'sessionKey'> & { sessionKey?: string };

function pruneExpiredExecutions(records: WorkflowExecutionRecord[]): WorkflowExecutionRecord[] {
  const now = Date.now();
  return records.filter((e) => now - e.createdAt < EXECUTION_TTL_MS);
}

function resolveSessionKeyForLegacyExecution(record: LegacyExecutionRecord): string | null {
  if (record.sessionKey) return record.sessionKey;
  const found = findWorkflowById(record.workflowId);
  return found?.sessionKey ?? null;
}

function migrateLegacyExecutions(parsed: LegacyExecutionRecord[]): ExecutionStore {
  const store: ExecutionStore = {};
  for (const raw of parsed) {
    const sessionKey = resolveSessionKeyForLegacyExecution(raw);
    if (!sessionKey) continue;
    const record: WorkflowExecutionRecord = {
      sessionKey,
      workflowId: raw.workflowId,
      runId: raw.runId,
      templateId: raw.templateId,
      templateName: raw.templateName,
      status: raw.status,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      collectedInputs: raw.collectedInputs ?? {},
    };
    if (!store[sessionKey]) store[sessionKey] = [];
    if (!store[sessionKey].some((e) => e.runId === record.runId)) {
      store[sessionKey].push(record);
    }
  }
  for (const key of Object.keys(store)) {
    store[key] = pruneExpiredExecutions(store[key]).slice(0, MAX_EXECUTIONS_PER_SESSION);
  }
  return store;
}

function loadExecutions(): ExecutionStore {
  try {
    const raw = localStorage.getItem(EXECUTIONS_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const migrated = migrateLegacyExecutions(parsed as LegacyExecutionRecord[]);
      saveExecutionsStore(migrated);
      return migrated;
    }

    if (parsed && typeof parsed === 'object') {
      const store = parsed as ExecutionStore;
      let changed = false;
      for (const sessionKey of Object.keys(store)) {
        const pruned = pruneExpiredExecutions(store[sessionKey] ?? []);
        if (pruned.length !== (store[sessionKey]?.length ?? 0)) {
          store[sessionKey] = pruned;
          changed = true;
        }
        if (pruned.length === 0) {
          delete store[sessionKey];
          changed = true;
        }
      }
      if (changed) saveExecutionsStore(store);
      return store;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveExecutionsStore(store: ExecutionStore): void {
  try {
    localStorage.setItem(EXECUTIONS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function getSessionExecutions(sessionKey: string): WorkflowExecutionRecord[] {
  const store = loadExecutions();
  return pruneExpiredExecutions(store[sessionKey] ?? []);
}

/**
 * Save a workflow execution record (workflowId + runId) for a session.
 */
export function saveWorkflowExecution(record: WorkflowExecutionRecord): void {
  const store = loadExecutions();
  const sessionKey = record.sessionKey;
  const sessionRecords = pruneExpiredExecutions(store[sessionKey] ?? []);
  const filtered = sessionRecords.filter((e) => e.runId !== record.runId);
  filtered.unshift(record);
  if (filtered.length > MAX_EXECUTIONS_PER_SESSION) {
    filtered.length = MAX_EXECUTIONS_PER_SESSION;
  }
  store[sessionKey] = filtered;
  saveExecutionsStore(store);
}

/**
 * Update execution status within its session.
 */
export function updateExecutionStatus(
  runId: string,
  status: WorkflowExecutionRecord['status'],
  sessionKey?: string,
): void {
  const store = loadExecutions();
  const sessionKeys = sessionKey ? [sessionKey] : Object.keys(store);
  for (const key of sessionKeys) {
    const records = store[key];
    if (!records) continue;
    const idx = records.findIndex((e) => e.runId === runId);
    if (idx >= 0) {
      records[idx] = { ...records[idx], status, updatedAt: Date.now() };
      store[key] = records;
      saveExecutionsStore(store);
      return;
    }
  }
}

/**
 * Get execution record by runId (optionally scoped to session).
 */
export function getExecutionByRunId(
  runId: string,
  sessionKey?: string,
): WorkflowExecutionRecord | undefined {
  if (sessionKey) {
    return getSessionExecutions(sessionKey).find((e) => e.runId === runId);
  }
  for (const records of Object.values(loadExecutions())) {
    const found = records.find((e) => e.runId === runId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Get the most recent execution record for a session.
 */
export function getLatestExecution(sessionKey: string): WorkflowExecutionRecord | undefined {
  return getSessionExecutions(sessionKey)[0];
}

/**
 * Find execution by workflowId within a session (or globally if session omitted).
 */
export function findExecutionByWorkflowId(
  workflowId: string,
  sessionKey?: string,
): WorkflowExecutionRecord | undefined {
  if (sessionKey) {
    return getSessionExecutions(sessionKey).find((e) => e.workflowId === workflowId);
  }
  for (const records of Object.values(loadExecutions())) {
    const found = records.find((e) => e.workflowId === workflowId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Clear all expired records across all sessions.
 */
export function cleanupExpiredRecords(): void {
  const data = load();
  let changed = false;
  for (const sessionKey of Object.keys(data)) {
    const pruned = pruneExpired(data[sessionKey]);
    if (pruned.length !== data[sessionKey].length) {
      data[sessionKey] = pruned;
      changed = true;
    }
    if (pruned.length === 0) {
      delete data[sessionKey];
      changed = true;
    }
  }
  if (changed) {
    save(data);
  }

  const execStore = loadExecutions();
  let execChanged = false;
  for (const sessionKey of Object.keys(execStore)) {
    const pruned = pruneExpiredExecutions(execStore[sessionKey] ?? []);
    if (pruned.length !== (execStore[sessionKey]?.length ?? 0)) {
      execStore[sessionKey] = pruned;
      execChanged = true;
    }
    if (pruned.length === 0) {
      delete execStore[sessionKey];
      execChanged = true;
    }
  }
  if (execChanged) {
    saveExecutionsStore(execStore);
  }
}
