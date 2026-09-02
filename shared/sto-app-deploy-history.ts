import {
  isCodeDeploySettled,
  pickCodeDeployFields,
  type CodeDeployRecordFields,
} from './code-deploy-status';

export const STO_DEPLOY_HISTORY_RELATIVE = '.sto/deploy-history.json';
export const STO_DEPLOY_HISTORY_MAX = 30;

export interface StoAppDeployHistoryRecord {
  deploymentId: string;
  appCode?: string;
  env?: string;
  status?: string;
  deploymentVersion?: string;
  failureMessage?: string;
  startedAt: number;
  updatedAt: number;
}

export interface StoAppDeployHistoryFile {
  version: 1;
  items: StoAppDeployHistoryRecord[];
}

function asTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export function parseStoAppDeployHistoryRecord(raw: unknown): StoAppDeployHistoryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const deploymentId = asTrimmedString(row.deploymentId, row.deployment_id);
  if (!deploymentId) return null;
  const now = Date.now();
  return {
    deploymentId,
    appCode: asTrimmedString(row.appCode, row.app_code, row.applicationId),
    env: asTrimmedString(row.env),
    status: asTrimmedString(row.status),
    deploymentVersion: asTrimmedString(row.deploymentVersion, row.deployment_version),
    failureMessage: asTrimmedString(row.failureMessage, row.failure_message),
    startedAt: asTimestamp(row.startedAt, now),
    updatedAt: asTimestamp(row.updatedAt, now),
  };
}

export function parseStoAppDeployHistoryFile(raw: unknown): StoAppDeployHistoryRecord[] {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  const list = Array.isArray(row.items) ? row.items : Array.isArray(raw) ? raw : [];
  const items: StoAppDeployHistoryRecord[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const parsed = parseStoAppDeployHistoryRecord(entry);
    if (!parsed || seen.has(parsed.deploymentId)) continue;
    seen.add(parsed.deploymentId);
    items.push(parsed);
  }
  return items;
}

export function serializeStoAppDeployHistoryFile(items: StoAppDeployHistoryRecord[]): string {
  const payload: StoAppDeployHistoryFile = { version: 1, items };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function upsertStoAppDeployHistoryItems(
  items: StoAppDeployHistoryRecord[],
  next: StoAppDeployHistoryRecord,
): StoAppDeployHistoryRecord[] {
  const rest = items.filter((item) => item.deploymentId !== next.deploymentId);
  return [next, ...rest].slice(0, STO_DEPLOY_HISTORY_MAX);
}

export function isStoAppDeployHistoryInProgress(record: Pick<StoAppDeployHistoryRecord, 'status' | 'failureMessage'>): boolean {
  return !isCodeDeploySettled(record);
}

export function findInProgressStoAppDeploy(
  items: StoAppDeployHistoryRecord[],
): StoAppDeployHistoryRecord | null {
  return items.find((item) => isStoAppDeployHistoryInProgress(item)) ?? null;
}

export function historyRecordFromDeployFields(
  fields: CodeDeployRecordFields,
  startedAt: number,
): StoAppDeployHistoryRecord | null {
  const deploymentId = fields.deploymentId?.trim();
  if (!deploymentId) return null;
  const now = Date.now();
  return {
    deploymentId,
    appCode: fields.applicationId?.trim() || undefined,
    env: fields.env?.trim() || undefined,
    status: fields.status?.trim() || undefined,
    deploymentVersion: fields.deploymentVersion?.trim() || undefined,
    failureMessage: fields.failureMessage?.trim() || undefined,
    startedAt,
    updatedAt: now,
  };
}

export function deployFieldsFromHistoryRecord(record: StoAppDeployHistoryRecord): CodeDeployRecordFields {
  return pickCodeDeployFields({
    deploymentId: record.deploymentId,
    app_code: record.appCode,
    env: record.env,
    status: record.status,
    deploymentVersion: record.deploymentVersion,
    failureMessage: record.failureMessage,
  });
}
