/**
 * Cloud Site App source revision list (memory-center).
 * Used for「最近提交」timeline; local push-history is offline fallback.
 */

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickTimeMs(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string' && value.trim()) {
      const asNum = Number(value);
      if (Number.isFinite(asNum) && asNum > 0) return asNum < 1e12 ? asNum * 1000 : asNum;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export interface SiteAppSourceRevision {
  revisionId: string;
  commitSha?: string;
  message?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: number;
  parentRevisionId?: string | null;
  mergeParentRevisionId?: string | null;
  sourceSha256?: string;
}

function unwrapList(json: unknown): unknown[] {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const candidates = [root.data, root.items, root.list, root.revisions];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const nestedList = nested.items ?? nested.list ?? nested.data ?? nested.revisions;
      if (Array.isArray(nestedList)) return nestedList;
    }
  }
  return [];
}

export function parseSiteAppSourceRevision(raw: unknown): SiteAppSourceRevision | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const revisionId = pickString(row.revisionId, row.revision_id, row.id);
  if (!revisionId) return null;
  return {
    revisionId,
    commitSha: pickString(row.commitSha, row.commit_sha),
    message: pickString(row.message, row.revisionMessage, row.revision_message, row.subject),
    createdBy: pickString(row.createdBy, row.created_by, row.creatorCode, row.creator_code),
    createdByName: pickString(
      row.createdByName,
      row.created_by_name,
      row.creatorName,
      row.creator_name,
    ),
    createdAt: pickTimeMs(row.createdAt, row.created_at, row.readyAt, row.ready_at) || undefined,
    parentRevisionId: pickString(row.parentRevisionId, row.parent_revision_id) ?? null,
    mergeParentRevisionId:
      pickString(row.mergeParentRevisionId, row.merge_parent_revision_id) ?? null,
    sourceSha256: pickString(row.sourceSha256, row.source_sha256),
  };
}

export function parseSiteAppSourceRevisions(json: unknown): SiteAppSourceRevision[] {
  const items: SiteAppSourceRevision[] = [];
  const seen = new Set<string>();
  for (const entry of unwrapList(json)) {
    const parsed = parseSiteAppSourceRevision(entry);
    if (!parsed || seen.has(parsed.revisionId)) continue;
    seen.add(parsed.revisionId);
    items.push(parsed);
  }
  return items;
}

export function siteAppRevisionToCheckpoint(revision: SiteAppSourceRevision): {
  hash: string;
  timestamp: number;
  subject: string;
  revisionId: string;
} {
  const who = revision.createdByName || revision.createdBy;
  const message = revision.message?.trim() || '提交源码';
  return {
    hash: revision.commitSha || revision.revisionId,
    timestamp: revision.createdAt || Date.now(),
    subject: who ? `${who} · ${message}` : message,
    revisionId: revision.revisionId,
  };
}
