/**
 * SClaw local workspace binding: `<appRoot>/.sto/workspace.json`.
 * v2 uses `appCode` as the cloud primary key. Never persist tokens.
 */

import type { SiteAppRecord } from './site-app-catalog';

export const STO_WORKSPACE_RELATIVE = '.sto/workspace.json';

export interface StoWorkspaceFile {
  version: 2;
  workspacePath: string;
  appCode: string;
  baseRevisionId: string | null;
  baseCommitSha: string | null;
  baseSourceSha256: string | null;
  mergeParentRevisionId: string | null;
}

export interface StoWorkspaceFields {
  appCode?: string;
  status?: string;
  baseRevisionId?: string | null;
  baseCommitSha?: string | null;
  baseSourceSha256?: string | null;
  mergeParentRevisionId?: string | null;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function unwrapRecord(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const row = json as Record<string, unknown>;
  const nestedCandidates = [row.data, row.app, row.application, row.result, row.workspace];
  for (const candidate of nestedCandidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return { ...row, ...(candidate as Record<string, unknown>) };
    }
  }
  return row;
}

export function isStoWorkspaceWritableStatus(status?: string): boolean {
  if (!status?.trim()) return true;
  const normalized = status.trim().toLowerCase();
  // Persist the binding for any in-progress cloud app (draft/creating/active/ready).
  // Only failed/archived apps must not be written, otherwise a later retry creates a second app.
  return normalized !== 'failed' && normalized !== 'archived';
}

export function extractStoWorkspaceFields(json: unknown): StoWorkspaceFields {
  const row = unwrapRecord(json);
  if (!row) return {};
  const fields: StoWorkspaceFields = {};
  const appCode = pickString(row.appCode, row.app_code, row.applicationCode, row.code);
  const status = pickString(row.status);
  const baseRevisionId = pickString(
    row.baseRevisionId,
    row.headRevisionId,
    row.head_revision_id,
    row.revisionId,
  );
  const baseCommitSha = pickString(
    row.baseCommitSha,
    row.headCommitSha,
    row.head_commit_sha,
    row.commitSha,
  );
  const baseSourceSha256 = pickString(
    row.baseSourceSha256,
    row.sourceSha256,
    row.head_source_sha256,
    row.headSourceSha256,
  );
  if (appCode) fields.appCode = appCode;
  if (status) fields.status = status;
  if (baseRevisionId) fields.baseRevisionId = baseRevisionId;
  if (baseCommitSha) fields.baseCommitSha = baseCommitSha;
  if (baseSourceSha256) fields.baseSourceSha256 = baseSourceSha256;
  if (Object.prototype.hasOwnProperty.call(row, 'mergeParentRevisionId')
    || Object.prototype.hasOwnProperty.call(row, 'merge_parent_revision_id')) {
    fields.mergeParentRevisionId = pickString(
      row.mergeParentRevisionId,
      row.merge_parent_revision_id,
    ) ?? null;
  }
  return fields;
}

export function mergeStoWorkspaceFields(
  ...parts: Array<StoWorkspaceFields | undefined>
): StoWorkspaceFields {
  const merged: StoWorkspaceFields = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.appCode) merged.appCode = part.appCode;
    if (part.status) merged.status = part.status;
    if (part.baseRevisionId !== undefined) merged.baseRevisionId = part.baseRevisionId;
    if (part.baseCommitSha !== undefined) merged.baseCommitSha = part.baseCommitSha;
    if (part.baseSourceSha256 !== undefined) merged.baseSourceSha256 = part.baseSourceSha256;
    if (part.mergeParentRevisionId !== undefined) {
      merged.mergeParentRevisionId = part.mergeParentRevisionId;
    }
  }
  return merged;
}

function parseLegacyV1Workspace(row: Record<string, unknown>): StoWorkspaceFile | null {
  const workspacePath = pickString(row.workspacePath);
  const appCode = pickString(row.appCode, row.app_code, row.applicationCode, row.applicationId);
  if (!workspacePath || !appCode) return null;
  return {
    version: 2,
    workspacePath,
    appCode,
    baseRevisionId: pickString(row.baseRevisionId) ?? null,
    baseCommitSha: pickString(row.baseCommitSha) ?? null,
    baseSourceSha256: pickString(row.baseSourceSha256) ?? null,
    mergeParentRevisionId: pickString(row.mergeParentRevisionId) ?? null,
  };
}

export function parseStoWorkspaceFile(raw: unknown): StoWorkspaceFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const version = row.version;
  const workspacePath = pickString(row.workspacePath);
  if (!workspacePath) return null;

  if (version === 2) {
    const appCode = pickString(row.appCode, row.app_code);
    if (!appCode) return null;
    return {
      version: 2,
      workspacePath,
      appCode,
      baseRevisionId: pickString(row.baseRevisionId) ?? null,
      baseCommitSha: pickString(row.baseCommitSha) ?? null,
      baseSourceSha256: pickString(row.baseSourceSha256) ?? null,
      mergeParentRevisionId: pickString(row.mergeParentRevisionId) ?? null,
    };
  }

  if (version === 1) {
    return parseLegacyV1Workspace(row);
  }

  const appCode = pickString(row.appCode, row.app_code, row.applicationCode);
  if (!appCode) return parseLegacyV1Workspace(row);
  return {
    version: 2,
    workspacePath,
    appCode,
    baseRevisionId: pickString(row.baseRevisionId) ?? null,
    baseCommitSha: pickString(row.baseCommitSha) ?? null,
    baseSourceSha256: pickString(row.baseSourceSha256) ?? null,
    mergeParentRevisionId: pickString(row.mergeParentRevisionId) ?? null,
  };
}

export function serializeStoWorkspaceFile(file: StoWorkspaceFile): string {
  const payload: StoWorkspaceFile = {
    version: 2,
    workspacePath: file.workspacePath,
    appCode: file.appCode,
    baseRevisionId: file.baseRevisionId,
    baseCommitSha: file.baseCommitSha,
    baseSourceSha256: file.baseSourceSha256,
    mergeParentRevisionId: file.mergeParentRevisionId,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function siteAppToWorkspaceFields(cloud?: SiteAppRecord): StoWorkspaceFields | undefined {
  if (!cloud) return undefined;
  return {
    appCode: cloud.appCode,
    status: cloud.status,
    baseRevisionId: cloud.headRevisionId,
    baseCommitSha: cloud.headCommitSha,
    baseSourceSha256: cloud.headSourceSha256,
  };
}

export function buildStoWorkspaceFile(input: {
  workspacePath: string;
  fields: StoWorkspaceFields;
  existing?: StoWorkspaceFile | null;
}): StoWorkspaceFile | null {
  const appCode = input.fields.appCode || input.existing?.appCode;
  if (!appCode) return null;
  if (!isStoWorkspaceWritableStatus(input.fields.status)) return null;
  return {
    version: 2,
    workspacePath: input.workspacePath,
    appCode,
    baseRevisionId: input.fields.baseRevisionId ?? input.existing?.baseRevisionId ?? null,
    baseCommitSha: input.fields.baseCommitSha ?? input.existing?.baseCommitSha ?? null,
    baseSourceSha256: input.fields.baseSourceSha256 ?? input.existing?.baseSourceSha256 ?? null,
    mergeParentRevisionId: input.fields.mergeParentRevisionId !== undefined
      ? input.fields.mergeParentRevisionId
      : input.existing?.mergeParentRevisionId ?? null,
  };
}
