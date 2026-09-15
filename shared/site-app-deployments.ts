/**
 * Cloud Site App deployment list + rollback (memory-center).
 * group_name is DevOps Founder Group — not the same as git group_code.
 */

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickTimeMs(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = pickNumber(value);
    if (n == null || n <= 0) continue;
    return n < 1e12 ? n * 1000 : n;
  }
  return undefined;
}

export interface SiteAppDeploymentRecord {
  id: number;
  appName?: string;
  appType?: string;
  iterateId?: number;
  /** Version / tag label shown in publish history (e.g. v1.0). */
  iterateName?: string;
  instanceId?: number;
  deployId?: string;
  md5?: string;
  isOnline?: boolean;
  available?: boolean;
  deployType?: string;
  createUser?: string;
  createTime?: number;
  updateTime?: number;
  /** Optional source anchors when backend provides them. */
  revisionId?: string;
  commitSha?: string;
}

export type SiteAppDeployRollbackStatus = 'success' | 'unknown' | string;

export interface SiteAppDeployRollbackResult {
  status: SiteAppDeployRollbackStatus;
  message?: string;
  groupName?: string;
  targetRecordId?: number;
  records: SiteAppDeploymentRecord[];
}

function unwrapData(json: unknown): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const root = json as Record<string, unknown>;
  if ('data' in root) return root.data;
  return json;
}

function unwrapList(json: unknown): unknown[] {
  const data = unwrapData(json);
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>;
    const nested = row.records ?? row.items ?? row.list;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function parseSiteAppDeploymentRecord(raw: unknown): SiteAppDeploymentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = pickNumber(row.id, row.recordId, row.record_id, row.targetRecordId);
  if (id == null || !Number.isFinite(id) || id <= 0) return null;
  return {
    id: Math.trunc(id),
    appName: pickString(row.appName, row.app_name),
    appType: pickString(row.appType, row.app_type),
    iterateId: pickNumber(row.iterateId, row.iterate_id),
    iterateName: pickString(row.iterateName, row.iterate_name, row.version, row.tag),
    instanceId: pickNumber(row.instanceId, row.instance_id),
    deployId: pickString(row.deployId, row.deploy_id),
    md5: pickString(row.md5),
    isOnline: typeof row.isOnline === 'boolean'
      ? row.isOnline
      : typeof row.is_online === 'boolean'
        ? row.is_online
        : undefined,
    available: typeof row.available === 'boolean' ? row.available : undefined,
    deployType: pickString(row.deployType, row.deploy_type),
    createUser: pickString(row.createUser, row.create_user),
    createTime: pickTimeMs(row.createTime, row.create_time),
    updateTime: pickTimeMs(row.updateTime, row.update_time),
    revisionId: pickString(row.revisionId, row.revision_id),
    commitSha: pickString(row.commitSha, row.commit_sha),
  };
}

export function parseSiteAppDeploymentList(json: unknown): SiteAppDeploymentRecord[] {
  const items: SiteAppDeploymentRecord[] = [];
  const seen = new Set<number>();
  for (const entry of unwrapList(json)) {
    const parsed = parseSiteAppDeploymentRecord(entry);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    items.push(parsed);
  }
  return items;
}

export function parseSiteAppDeployRollbackResult(json: unknown): SiteAppDeployRollbackResult {
  const data = unwrapData(json);
  const row = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
  const status = pickString(row.status) || 'unknown';
  const records = parseSiteAppDeploymentList(
    Array.isArray(row.records) ? row.records : json,
  );
  return {
    status,
    message: pickString(row.message, row.errMessage, row.err_message),
    groupName: pickString(row.groupName, row.group_name),
    targetRecordId: pickNumber(row.targetRecordId, row.target_record_id),
    records,
  };
}
