/**
 * Workflow Memory Store
 *
 * Persists created workflow metadata to localStorage so that
 * "帮我执行" (help me execute) can recover the workflow even
 * after page refresh or app restart.
 *
 * Storage key: stoclaw:session-workflows
 * Format: Record<sessionKey, WorkflowMemoryRecord[]>
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

// ── Workflow Execution Records ───────────────────────────────────────

const MAX_EXECUTIONS = 50;
const EXECUTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for active tracking

function loadExecutions(): WorkflowExecutionRecord[] {
  try {
    const raw = localStorage.getItem(EXECUTIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as WorkflowExecutionRecord[];
      const now = Date.now();
      return parsed.filter((e) => now - e.createdAt < EXECUTION_TTL_MS);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveExecutions(executions: WorkflowExecutionRecord[]): void {
  try {
    localStorage.setItem(EXECUTIONS_STORAGE_KEY, JSON.stringify(executions));
  } catch {
    // ignore
  }
}

/**
 * Save a workflow execution record (workflowId + runId).
 */
export function saveWorkflowExecution(record: WorkflowExecutionRecord): void {
  const executions = loadExecutions();
  // Remove existing record with same runId if any
  const filtered = executions.filter((e) => e.runId !== record.runId);
  filtered.unshift(record); // newest first
  if (filtered.length > MAX_EXECUTIONS) {
    filtered.length = MAX_EXECUTIONS;
  }
  saveExecutions(filtered);
}

/**
 * Update execution status.
 */
export function updateExecutionStatus(
  runId: string,
  status: WorkflowExecutionRecord['status'],
): void {
  const executions = loadExecutions();
  const idx = executions.findIndex((e) => e.runId === runId);
  if (idx >= 0) {
    executions[idx] = { ...executions[idx], status, updatedAt: Date.now() };
    saveExecutions(executions);
  }
}

/**
 * Get execution record by runId.
 */
export function getExecutionByRunId(
  runId: string,
): WorkflowExecutionRecord | undefined {
  return loadExecutions().find((e) => e.runId === runId);
}

/**
 * Get the most recent execution record.
 */
export function getLatestExecution(): WorkflowExecutionRecord | undefined {
  const executions = loadExecutions();
  return executions[0];
}

/**
 * Find execution by workflowId.
 */
export function findExecutionByWorkflowId(
  workflowId: string,
): WorkflowExecutionRecord | undefined {
  return loadExecutions().find((e) => e.workflowId === workflowId);
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
}
