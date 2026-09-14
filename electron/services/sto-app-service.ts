/**
 * User-app collaboration facade — Site App HTTP source sync via code-collab-service.
 * List / archive / create / commit / snapshot use memory-center HTTP in site-app-api.ts.
 */
import { resolve } from 'path';
import {
  cloneCodeApplication,
  continueCodeApplicationMerge,
  getCodeCollabStatus,
  listCodeApplicationConflicts,
  pullCodeApplication,
  pushCodeApplication,
  resolveCodeApplicationConflict,
  type CodeCollabCommandResult,
  type CodeCollabStatusSummary,
} from './code-collab-service';
import type { SourceConflictFile } from '../../shared/site-app-source-merge';

export interface StoAppCommandResult {
  ok: boolean;
  output: string;
  json?: unknown;
}

export type StoAppStatusSummary = CodeCollabStatusSummary;
export type StoAppConflictFile = SourceConflictFile;

function toCommandResult(result: CodeCollabCommandResult): StoAppCommandResult {
  return {
    ok: result.ok,
    output: result.output,
    json: result.json,
  };
}

export function resolveStoAppExecutable(): string | null {
  return 'site-apps';
}

export async function getStoAppStatus(appPath: string): Promise<StoAppStatusSummary> {
  return getCodeCollabStatus(appPath);
}

export async function pushStoApp(
  appPath: string,
  message: string,
  hints?: { workspaceId?: string },
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await pushCodeApplication(appPath, message, hints));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function pullStoApp(appPath: string): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await pullCodeApplication(appPath));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function continueStoAppMerge(
  appPath: string,
  revisionId: string,
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await continueCodeApplicationMerge(appPath, revisionId));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function listStoAppConflicts(appPath: string): Promise<StoAppConflictFile[]> {
  return listCodeApplicationConflicts(appPath);
}

export async function resolveStoAppConflict(
  appPath: string,
  path: string,
  choice: 'ours' | 'theirs',
): Promise<StoAppConflictFile[]> {
  return resolveCodeApplicationConflict(appPath, path, choice);
}

export async function cloneStoApp(
  appCode: string,
  targetDir: string,
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await cloneCodeApplication(appCode, targetDir));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function extractAppCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const row = json as Record<string, unknown>;
  const pick = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  return pick(
    row.appCode,
    row.app_code,
    row.applicationCode,
    (row.application as Record<string, unknown> | undefined)?.appCode,
    (row.data as Record<string, unknown> | undefined)?.appCode,
  );
}

export async function getStoAppBindingPath(appPath: string): Promise<string> {
  return resolve(appPath);
}
