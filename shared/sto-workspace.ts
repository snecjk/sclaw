/**
 * SClaw local workspace binding: `<appRoot>/.sto/workspace.json`.
 * Field names match sto-app CLI workspace.ts. Never persist tokens.
 */

import type { CodeApplicationRecord } from './code-application-catalog';

export const STO_WORKSPACE_RELATIVE = '.sto/workspace.json';

export interface StoWorkspaceFile {
  version: 1;
  workspacePath: string;
  registryUrl: string;
  applicationId: string;
  applicationUid: string;
  applicationCode: string;
  baseRevisionId: string | null;
  baseCommitSha: string | null;
  baseSourceSha256: string | null;
  mergeParentRevisionId: string | null;
}

export interface StoWorkspaceFields {
  applicationId?: string;
  applicationUid?: string;
  applicationCode?: string;
  status?: string;
  baseRevisionId?: string | null;
  baseCommitSha?: string | null;
  baseSourceSha256?: string | null;
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
  const normalized = status.trim().toUpperCase();
  if (normalized === 'FAILED') return false;
  return normalized === 'ACTIVE';
}

export function extractStoWorkspaceFields(json: unknown): StoWorkspaceFields {
  const row = unwrapRecord(json);
  if (!row) return {};
  const fields: StoWorkspaceFields = {};
  const applicationId = pickString(row.applicationId, row.appId, row.application_id, row.id);
  const applicationUid = pickString(row.applicationUid, row.appUid, row.uid);
  const applicationCode = pickString(row.applicationCode, row.appCode, row.code);
  const status = pickString(row.status);
  const baseRevisionId = pickString(row.baseRevisionId, row.headRevisionId, row.revisionId);
  const baseCommitSha = pickString(
    row.baseCommitSha,
    row.headCommitSha,
    row.commitSha,
    row.devCommitSha,
  );
  const baseSourceSha256 = pickString(
    row.baseSourceSha256,
    row.sourceSha256,
    row.headSourceSha256,
  );
  if (applicationId) fields.applicationId = applicationId;
  if (applicationUid) fields.applicationUid = applicationUid;
  if (applicationCode) fields.applicationCode = applicationCode;
  if (status) fields.status = status;
  if (baseRevisionId) fields.baseRevisionId = baseRevisionId;
  if (baseCommitSha) fields.baseCommitSha = baseCommitSha;
  if (baseSourceSha256) fields.baseSourceSha256 = baseSourceSha256;
  return fields;
}

export function mergeStoWorkspaceFields(
  ...parts: Array<StoWorkspaceFields | undefined>
): StoWorkspaceFields {
  const merged: StoWorkspaceFields = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.applicationId) merged.applicationId = part.applicationId;
    if (part.applicationUid) merged.applicationUid = part.applicationUid;
    if (part.applicationCode) merged.applicationCode = part.applicationCode;
    if (part.status) merged.status = part.status;
    if (part.baseRevisionId !== undefined) merged.baseRevisionId = part.baseRevisionId;
    if (part.baseCommitSha !== undefined) merged.baseCommitSha = part.baseCommitSha;
    if (part.baseSourceSha256 !== undefined) merged.baseSourceSha256 = part.baseSourceSha256;
  }
  return merged;
}

export function parseStoWorkspaceFile(raw: unknown): StoWorkspaceFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const applicationId = pickString(row.applicationId);
  const workspacePath = pickString(row.workspacePath);
  const registryUrl = pickString(row.registryUrl);
  if (!applicationId || !workspacePath || !registryUrl) return null;
  return {
    version: 1,
    workspacePath,
    registryUrl,
    applicationId,
    applicationUid: pickString(row.applicationUid) ?? '',
    applicationCode: pickString(row.applicationCode) ?? '',
    baseRevisionId: pickString(row.baseRevisionId) ?? null,
    baseCommitSha: pickString(row.baseCommitSha) ?? null,
    baseSourceSha256: pickString(row.baseSourceSha256) ?? null,
    mergeParentRevisionId: pickString(row.mergeParentRevisionId) ?? null,
  };
}

export function serializeStoWorkspaceFile(file: StoWorkspaceFile): string {
  const payload: StoWorkspaceFile = {
    version: 1,
    workspacePath: file.workspacePath,
    registryUrl: file.registryUrl,
    applicationId: file.applicationId,
    applicationUid: file.applicationUid,
    applicationCode: file.applicationCode,
    baseRevisionId: file.baseRevisionId,
    baseCommitSha: file.baseCommitSha,
    baseSourceSha256: file.baseSourceSha256,
    mergeParentRevisionId: file.mergeParentRevisionId,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function codeApplicationToWorkspaceFields(
  cloud?: CodeApplicationRecord,
): StoWorkspaceFields | undefined {
  if (!cloud) return undefined;
  return {
    applicationId: cloud.applicationId,
    applicationUid: cloud.applicationUid,
    applicationCode: cloud.applicationCode,
    status: cloud.status,
    baseRevisionId: cloud.headRevisionId,
    baseCommitSha: cloud.headCommitSha,
    baseSourceSha256: cloud.sourceSha256,
  };
}

export function buildStoWorkspaceFile(input: {
  workspacePath: string;
  registryUrl: string;
  fields: StoWorkspaceFields;
  existing?: StoWorkspaceFile | null;
}): StoWorkspaceFile | null {
  const applicationId = input.fields.applicationId || input.existing?.applicationId;
  if (!applicationId) return null;
  if (!isStoWorkspaceWritableStatus(input.fields.status)) return null;

  const registryUrl = input.registryUrl.replace(/\/+$/, '');
  return {
    version: 1,
    workspacePath: input.workspacePath,
    registryUrl,
    applicationId,
    applicationUid: input.fields.applicationUid || input.existing?.applicationUid || '',
    applicationCode: input.fields.applicationCode || input.existing?.applicationCode || '',
    baseRevisionId: input.fields.baseRevisionId ?? input.existing?.baseRevisionId ?? null,
    baseCommitSha: input.fields.baseCommitSha ?? input.existing?.baseCommitSha ?? null,
    baseSourceSha256: input.fields.baseSourceSha256 ?? input.existing?.baseSourceSha256 ?? null,
    mergeParentRevisionId: null,
  };
}
