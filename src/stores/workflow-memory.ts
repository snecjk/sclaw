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
  /** Workflow version snapshot used by workflow-runtime:start to fetch DSL. */
  versionId?: string | number;
  /** Last run id for re-execution and result lookup */
  lastRunId?: string;
  /** Last known execution status */
  lastStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';
  /** When the workflow last completed (success or failure) */
  completedAt?: number;
  /** All runs for this workflow instance (newest first). */
  runs?: WorkflowRunRef[];
}

export interface WorkflowRunRef {
  runId: string;
  status: WorkflowExecutionRecord['status'];
  createdAt: number;
  updatedAt: number;
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
  /** Workflow version snapshot used by workflow-runtime:start to fetch DSL. */
  versionId?: string | number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'unknown';
  createdAt: number;        // When execution was started
  updatedAt: number;        // Last status update
  collectedInputs: Record<string, unknown>;  // User-filled parameters
  /** Human-readable parameter summary for chat UI restore. */
  paramsSummary?: string;
  /** Model completion summary already sent for this run. */
  completionSummaryDelivered?: boolean;
  /** Completion notification already delivered in this client profile. */
  completionNotificationDeliveredAt?: number;
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
    const prev = sessionRecords[idx];
    let runs = prev.runs;
    if (metadata.lastRunId && metadata.lastStatus) {
      const runRef: WorkflowRunRef = {
        runId: metadata.lastRunId,
        status: metadata.lastStatus,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      runs = [runRef, ...(runs ?? []).filter((r) => r.runId !== runRef.runId)];
    } else if (metadata.lastRunId && metadata.lastStatus === undefined) {
      runs = (runs ?? []).map((r) =>
        r.runId === metadata.lastRunId
          ? { ...r, status: metadata.lastStatus ?? r.status, updatedAt: Date.now() }
          : r,
      );
    }
    sessionRecords[idx] = { ...prev, ...metadata, runs };
    data[sessionKey] = sessionRecords;
    save(data);
  }
}

function appendRunToWorkflowRecord(
  sessionKey: string,
  workflowId: string,
  run: WorkflowRunRef,
): void {
  const data = load();
  const sessionRecords = data[sessionKey] || [];
  const idx = sessionRecords.findIndex((r) => r.workflowId === workflowId);
  if (idx < 0) return;
  const prev = sessionRecords[idx];
  const runs = [run, ...(prev.runs ?? []).filter((r) => r.runId !== run.runId)].slice(0, MAX_EXECUTIONS_PER_SESSION);
  sessionRecords[idx] = {
    ...prev,
    lastRunId: run.runId,
    lastStatus: run.status,
    runs,
  };
  data[sessionKey] = sessionRecords;
  save(data);
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
  clearPendingWorkflowDraft(sessionKey, record.templateId);
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

/** True when the session already started a workflow (skip param form recovery). */
export function sessionHasWorkflowExecution(
  sessionKey: string,
  templateId?: string,
): boolean {
  const workflows = getSessionWorkflows(sessionKey);
  const executions = getSessionExecutions(sessionKey);

  if (templateId) {
    if (workflows.some((w) => w.templateId === templateId && w.lastRunId)) return true;
    return executions.some((e) => e.templateId === templateId);
  }
  if (workflows.some((w) => w.lastRunId)) return true;
  return executions.length > 0;
}

/** All runs for a workflow instance in a session (newest first). */
export function getWorkflowRuns(
  sessionKey: string,
  workflowId: string,
): WorkflowRunRef[] {
  const record = getSessionWorkflows(sessionKey).find((w) => w.workflowId === workflowId);
  if (record?.runs?.length) return record.runs;
  const execRuns = getSessionExecutions(sessionKey)
    .filter((e) => e.workflowId === workflowId)
    .map((e) => ({
      runId: e.runId,
      status: e.status,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    }));
  return execRuns;
}

/** Latest run for a specific workflow instance. */
export function getLatestRunForWorkflow(
  sessionKey: string,
  workflowId: string,
): WorkflowRunRef | undefined {
  return getWorkflowRuns(sessionKey, workflowId)[0];
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

  appendRunToWorkflowRecord(sessionKey, record.workflowId, {
    runId: record.runId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });

  if (record.templateId) {
    clearPendingWorkflowDraft(sessionKey, record.templateId);
  }
}

export function patchWorkflowExecution(
  sessionKey: string,
  runId: string,
  patch: Partial<Pick<WorkflowExecutionRecord, 'status' | 'paramsSummary' | 'completionSummaryDelivered' | 'completionNotificationDeliveredAt' | 'updatedAt'>>,
): void {
  const store = loadExecutions();
  const records = store[sessionKey];
  if (!records) return;
  const idx = records.findIndex((e) => e.runId === runId);
  if (idx < 0) return;
  records[idx] = { ...records[idx], ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  store[sessionKey] = records;
  saveExecutionsStore(store);
}

export function markCompletionSummaryDelivered(sessionKey: string, runId: string): void {
  patchWorkflowExecution(sessionKey, runId, { completionSummaryDelivered: true });
}

/** Persist notification delivery so duplicate terminal broadcasts never re-toast a run. */
export function markCompletionNotificationDelivered(sessionKey: string, runId: string): void {
  patchWorkflowExecution(sessionKey, runId, { completionNotificationDeliveredAt: Date.now() });
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
  const now = Date.now();
  for (const key of sessionKeys) {
    const records = store[key];
    if (!records) continue;
    const idx = records.findIndex((e) => e.runId === runId);
    if (idx >= 0) {
      const exec = records[idx];
      records[idx] = { ...exec, status, updatedAt: now };
      store[key] = records;
      saveExecutionsStore(store);
      syncRunStatusToWorkflowRecord(key, exec.workflowId, runId, status, now);
      if (exec.templateId && (status === 'completed' || status === 'failed' || status === 'timeout')) {
        clearPendingWorkflowDraft(key, exec.templateId);
      }
      return;
    }
  }
}

function syncRunStatusToWorkflowRecord(
  sessionKey: string,
  workflowId: string,
  runId: string,
  status: WorkflowExecutionRecord['status'],
  updatedAt: number,
): void {
  const data = load();
  const sessionRecords = data[sessionKey] || [];
  const idx = sessionRecords.findIndex((r) => r.workflowId === workflowId);
  if (idx < 0) return;

  const prev = sessionRecords[idx];
  const runs = (prev.runs ?? []).map((r) =>
    r.runId === runId ? { ...r, status, updatedAt } : r,
  );
  const isTerminal = status === 'completed' || status === 'failed' || status === 'timeout';
  sessionRecords[idx] = {
    ...prev,
    lastStatus: prev.lastRunId === runId ? status : prev.lastStatus,
    completedAt: prev.lastRunId === runId && isTerminal ? updatedAt : prev.completedAt,
    runs,
  };
  data[sessionKey] = sessionRecords;
  save(data);
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
 * Find the latest execution for a workflowId within a session (or globally if session omitted).
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

/** All executions for a workflow instance (newest first). */
export function findExecutionsByWorkflowId(
  workflowId: string,
  sessionKey?: string,
): WorkflowExecutionRecord[] {
  if (sessionKey) {
    return getSessionExecutions(sessionKey).filter((e) => e.workflowId === workflowId);
  }
  const all: WorkflowExecutionRecord[] = [];
  for (const records of Object.values(loadExecutions())) {
    all.push(...records.filter((e) => e.workflowId === workflowId));
  }
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// ── Pending workflow draft (parameter confirmation, before createWorkflow) ──

export interface PendingWorkflowDraft {
  templateId: string;
  templateName: string;
  schemaHash: string;
  collectedInputs?: Record<string, unknown>;
  modelGuidanceSent?: boolean;
  updatedAt: number;
}

const PENDING_DRAFT_STORAGE_KEY = 'stoclaw:session-pending-workflows';
const PENDING_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function pendingDraftCompoundKey(sessionKey: string, templateId: string): string {
  return `${sessionKey}::${templateId}`;
}

function isPendingDraftKeyForSession(key: string, sessionKey: string): boolean {
  return key === sessionKey || key.startsWith(`${sessionKey}::`);
}

function loadPendingDrafts(): Record<string, PendingWorkflowDraft> {
  try {
    const raw = localStorage.getItem(PENDING_DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PendingWorkflowDraft>;
    const now = Date.now();
    const result: Record<string, PendingWorkflowDraft> = {};
    for (const [key, draft] of Object.entries(parsed)) {
      if (now - draft.updatedAt < PENDING_DRAFT_TTL_MS) {
        result[key] = draft;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function savePendingDrafts(store: Record<string, PendingWorkflowDraft>): void {
  try {
    localStorage.setItem(PENDING_DRAFT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function savePendingWorkflowDraft(sessionKey: string, draft: Omit<PendingWorkflowDraft, 'updatedAt'>): void {
  const store = loadPendingDrafts();
  const key = pendingDraftCompoundKey(sessionKey, draft.templateId);
  store[key] = { ...draft, updatedAt: Date.now() };
  // Remove legacy session-only key when it referred to the same template.
  if (store[sessionKey]?.templateId === draft.templateId) {
    delete store[sessionKey];
  }
  savePendingDrafts(store);
}

/** Get pending param draft for a session, optionally scoped to one template. */
export function getPendingWorkflowDraft(
  sessionKey: string,
  templateId?: string,
): PendingWorkflowDraft | undefined {
  const store = loadPendingDrafts();
  if (templateId) {
    return store[pendingDraftCompoundKey(sessionKey, templateId)]
      ?? (store[sessionKey]?.templateId === templateId ? store[sessionKey] : undefined);
  }

  let best: PendingWorkflowDraft | undefined;
  for (const [key, draft] of Object.entries(store)) {
    if (!isPendingDraftKeyForSession(key, sessionKey)) continue;
    if (!best || draft.updatedAt > best.updatedAt) best = draft;
  }
  return best;
}

export function clearPendingWorkflowDraft(sessionKey: string, templateId?: string): void {
  const store = loadPendingDrafts();
  if (templateId) {
    delete store[pendingDraftCompoundKey(sessionKey, templateId)];
    if (store[sessionKey]?.templateId === templateId) {
      delete store[sessionKey];
    }
  } else {
    for (const key of Object.keys(store)) {
      if (isPendingDraftKeyForSession(key, sessionKey)) {
        delete store[key];
      }
    }
  }
  savePendingDrafts(store);
}

/** All execution records for a session (newest first). */
export function listSessionExecutions(sessionKey: string): WorkflowExecutionRecord[] {
  return getSessionExecutions(sessionKey);
}

/** Rebuild in-memory workflow card states after refresh or session switch. */
export function buildWorkflowCardStatesForSession(
  sessionKey: string,
): Record<string, import('@/types/workflow').WorkflowExecutionState> {
  const states: Record<string, import('@/types/workflow').WorkflowExecutionState> = {};
  for (const exec of getSessionExecutions(sessionKey)) {
    states[exec.runId] = {
      runId: exec.runId,
      workflowId: exec.workflowId,
      status: exec.status,
      progress: exec.status === 'completed' ? 100 : 0,
      steps: [],
      startedAt: new Date(exec.createdAt).toISOString(),
    };
  }
  return states;
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
