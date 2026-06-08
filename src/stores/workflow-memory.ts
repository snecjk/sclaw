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

const STORAGE_KEY = 'stoclaw:session-workflows';
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
