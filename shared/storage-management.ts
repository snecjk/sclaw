export type StorageSeverity = 'normal' | 'warning' | 'critical';
export type StorageTargetStatus = 'ready' | 'missing' | 'unavailable' | 'in-use';

export interface StorageDiskSummary {
  availableBytes: number;
  totalBytes: number;
  severity: StorageSeverity;
}

export interface StorageTarget {
  id: string;
  name: string;
  bytes: number;
  fileCount: number;
  latestModifiedAt: string | null;
  status: StorageTargetStatus;
}

export interface StorageUsage {
  bytes: number;
  fileCount: number;
}

export interface WorkspaceStorageTarget extends StorageTarget {
  cleanupBuckets: {
    olderThan7Days: StorageUsage;
    olderThan30Days: StorageUsage;
    olderThan90Days: StorageUsage;
    all: StorageUsage;
  };
}

export interface WorkflowRunStorageTarget extends StorageTarget {
  runId: string;
  workflowName: string | null;
  runStatus: string | null;
  deletable: boolean;
  orphaned: boolean;
}

export interface StorageOverview {
  scannedAt: string;
  disk: StorageDiskSummary;
  managedBytes: number;
  managedSeverity: StorageSeverity;
  appCache: StorageTarget;
  appLogs: StorageTarget;
  openClaw: StorageTarget;
  workspaces: WorkspaceStorageTarget[];
  workflowRuntime: {
    bytes: number;
    fileCount: number;
    runs: WorkflowRunStorageTarget[];
  };
}

export interface StorageCleanupRequest {
  targetIds: string[];
  mode: StorageCleanupMode;
  policy?: StorageCleanupPolicy;
}

export type StorageCleanupMode = 'trash' | 'delete';

export type StorageCleanupDays = 7 | 30 | 90;

export type StorageCleanupPolicy =
  | { kind: 'older-than'; days: StorageCleanupDays }
  | { kind: 'all' };

export type StorageCleanupErrorCode =
  | 'TARGET_IN_USE'
  | 'ACCESS_DENIED'
  | 'PATH_INVALID'
  | 'TRASH_FAILED'
  | 'DELETE_FAILED';

export interface StorageCleanupResult {
  mode: StorageCleanupMode;
  cleanedBytes: number;
  movedToTrashBytes: number;
  permanentlyDeletedBytes: number;
  diskFreeBytesBefore: number | null;
  diskFreeBytesAfter: number | null;
  targets: Array<{
    id: string;
    status: 'cleaned' | 'partial' | 'skipped' | 'failed';
    bytes: number;
    matchedFileCount: number;
    cleanedFileCount: number;
    skippedFileCount: number;
    failedFileCount: number;
    errorCode?: StorageCleanupErrorCode;
  }>;
}

export interface StorageOpenRequest {
  targetId: string;
}

export type StorageOpenErrorCode =
  | 'TARGET_NOT_FOUND'
  | 'PATH_INVALID'
  | 'CREATE_FAILED'
  | 'OPEN_FAILED';

export interface StorageOpenResult {
  opened: boolean;
  errorCode?: StorageOpenErrorCode;
}

export const STORAGE_BYTES = {
  gib: 1024 ** 3,
  diskWarning: 10 * 1024 ** 3,
  diskCritical: 5 * 1024 ** 3,
  managedWarning: 10 * 1024 ** 3,
  managedCritical: 30 * 1024 ** 3,
} as const;

export function resolveDiskStorageSeverity(
  availableBytes: number,
  totalBytes: number,
): StorageSeverity {
  if (totalBytes <= 0) return 'normal';
  const ratio = availableBytes / totalBytes;
  if (availableBytes < STORAGE_BYTES.diskCritical || ratio < 0.05) return 'critical';
  if (availableBytes < STORAGE_BYTES.diskWarning || ratio < 0.1) return 'warning';
  return 'normal';
}

export function resolveManagedStorageSeverity(bytes: number): StorageSeverity {
  if (bytes >= STORAGE_BYTES.managedCritical) return 'critical';
  if (bytes >= STORAGE_BYTES.managedWarning) return 'warning';
  return 'normal';
}

export function maxStorageSeverity(...values: StorageSeverity[]): StorageSeverity {
  if (values.includes('critical')) return 'critical';
  if (values.includes('warning')) return 'warning';
  return 'normal';
}

export function shouldShowStorageReminder(input: {
  enabled: boolean;
  lastShownLocalDate: string | null;
  todayLocalDate: string;
  diskSeverity: StorageSeverity;
  managedSeverity: StorageSeverity;
}): boolean {
  return input.enabled
    && input.lastShownLocalDate !== input.todayLocalDate
    && maxStorageSeverity(input.diskSeverity, input.managedSeverity) !== 'normal';
}

export function resolveStorageCleanupCutoff(now: Date, days: StorageCleanupDays): number {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.getTime();
}
