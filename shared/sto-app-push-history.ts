/** Local CLI submit history: `<appRoot>/.sto/push-history.json`. */

export const STO_PUSH_HISTORY_RELATIVE = '.sto/push-history.json';
export const STO_PUSH_HISTORY_MAX = 30;

export interface StoAppPushHistoryRecord {
  revisionId: string;
  appCode: string;
  message: string;
  commitSha?: string;
  createdAt: number;
}

export interface StoAppPushHistoryFile {
  version: 1;
  items: StoAppPushHistoryRecord[];
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

export function parseStoAppPushHistoryRecord(raw: unknown): StoAppPushHistoryRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const revisionId = asTrimmedString(row.revisionId, row.revision_id);
  const appCode = asTrimmedString(row.appCode, row.app_code);
  const message = asTrimmedString(row.message, row.revisionMessage, row.revision_message) ?? '';
  if (!revisionId || !appCode) return null;
  const now = Date.now();
  return {
    revisionId,
    appCode,
    message: message || '提交代码',
    commitSha: asTrimmedString(row.commitSha, row.commit_sha),
    createdAt: asTimestamp(row.createdAt, now),
  };
}

export function parseStoAppPushHistoryFile(raw: unknown): StoAppPushHistoryRecord[] {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  const list = Array.isArray(row.items) ? row.items : Array.isArray(raw) ? raw : [];
  const items: StoAppPushHistoryRecord[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const parsed = parseStoAppPushHistoryRecord(entry);
    if (!parsed || seen.has(parsed.revisionId)) continue;
    seen.add(parsed.revisionId);
    items.push(parsed);
  }
  return items;
}

export function serializeStoAppPushHistoryFile(items: StoAppPushHistoryRecord[]): string {
  const payload: StoAppPushHistoryFile = { version: 1, items };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function upsertStoAppPushHistoryItems(
  items: StoAppPushHistoryRecord[],
  next: StoAppPushHistoryRecord,
): StoAppPushHistoryRecord[] {
  const rest = items.filter((item) => item.revisionId !== next.revisionId);
  return [next, ...rest].slice(0, STO_PUSH_HISTORY_MAX);
}

export function stoAppPushToCheckpoint(record: StoAppPushHistoryRecord): {
  hash: string;
  subject: string;
  timestamp: number;
} {
  return {
    hash: record.commitSha || record.revisionId,
    subject: record.message,
    timestamp: record.createdAt,
  };
}
