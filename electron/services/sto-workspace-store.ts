/**
 * Read/write `<appRoot>/.sto/workspace.json` after cloud create / clone.
 * Does not store stoToken or other credentials.
 */

import { mkdir, readFile, realpath, rename, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import {
  STO_WORKSPACE_RELATIVE,
  buildStoWorkspaceFile,
  extractStoWorkspaceFields,
  isStoWorkspaceWritableStatus,
  mergeStoWorkspaceFields,
  parseStoWorkspaceFile,
  serializeStoWorkspaceFile,
  type StoWorkspaceFields,
  type StoWorkspaceFile,
} from '../../shared/sto-workspace';
import { logger } from '../utils/logger';

export function stoWorkspaceFilePath(appPath: string): string {
  return join(appPath, ...STO_WORKSPACE_RELATIVE.split('/'));
}

export async function readStoWorkspaceFile(appPath: string): Promise<StoWorkspaceFile | null> {
  const path = stoWorkspaceFilePath(appPath);
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return parseStoWorkspaceFile(raw);
  } catch {
    return null;
  }
}

export async function writeStoWorkspaceBinding(input: {
  appPath: string;
  registryUrl: string;
  payload?: unknown;
  cloud?: StoWorkspaceFields;
  fallback?: StoWorkspaceFields;
}): Promise<StoWorkspaceFile | null> {
  const fields = mergeStoWorkspaceFields(
    input.fallback,
    input.cloud,
    extractStoWorkspaceFields(input.payload),
  );
  if (!fields.applicationId || !isStoWorkspaceWritableStatus(fields.status)) {
    logger.warn(
      `[sto-workspace] skip write appPath=${input.appPath} ` +
      `applicationId=${fields.applicationId ?? '-'} status=${fields.status ?? '-'}`,
    );
    return null;
  }

  const workspacePath = await realpath(input.appPath);
  const existing = await readStoWorkspaceFile(workspacePath);
  const next = buildStoWorkspaceFile({
    workspacePath,
    registryUrl: input.registryUrl,
    fields,
    existing,
  });
  if (!next) {
    logger.warn(`[sto-workspace] skip write missing applicationId appPath=${workspacePath}`);
    return null;
  }

  const path = stoWorkspaceFilePath(workspacePath);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, serializeStoWorkspaceFile(next), 'utf8');
  await rename(tmp, path);
  logger.info(
    `[sto-workspace] wrote ${path} applicationId=${next.applicationId} ` +
    `uid=${next.applicationUid || '-'} code=${next.applicationCode || '-'} ` +
    `revision=${next.baseRevisionId ?? 'null'}`,
  );
  return next;
}
