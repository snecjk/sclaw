/**
 * User-app collaboration facade — delegates to sai-cli via code-collab-service.
 * List / offline / create remain HTTP in code-application-api.ts.
 */
import { resolve } from 'path';
import {
  cloneCodeApplication,
  continueCodeApplicationMerge,
  getCodeCollabStatus,
  pullCodeApplication,
  pushCodeApplication,
  type CodeCollabCommandResult,
  type CodeCollabStatusSummary,
} from './code-collab-service';

export interface StoAppCommandResult {
  ok: boolean;
  output: string;
  json?: unknown;
}

export type StoAppStatusSummary = CodeCollabStatusSummary;

function toCommandResult(result: CodeCollabCommandResult): StoAppCommandResult {
  return {
    ok: result.ok,
    output: result.output,
    json: result.json,
  };
}

export function resolveStoAppExecutable(): string | null {
  return 'sai-cli';
}

export async function getStoAppStatus(appPath: string): Promise<StoAppStatusSummary> {
  return getCodeCollabStatus(appPath);
}

export async function pushStoApp(
  appPath: string,
  message: string,
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await pushCodeApplication(appPath, message));
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

export async function cloneStoApp(
  applicationId: string,
  targetDir: string,
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(await cloneCodeApplication(applicationId, targetDir));
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** @deprecated list uses HTTP code-application-api */
export async function listStoApps(): Promise<{
  ok: boolean;
  apps: Array<{ applicationId: string; applicationName: string; raw?: unknown }>;
  output: string;
}> {
  return { ok: false, apps: [], output: '请使用 code-application HTTP 列表接口' };
}

/** @deprecated create uses HTTP code-application-api */
export async function createStoApp(): Promise<StoAppCommandResult> {
  throw new Error('createStoApp 已弃用，请使用 code-collab-service.createCodeApplication');
}

export function extractApplicationId(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const row = json as Record<string, unknown>;
  const pick = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };
  return pick(
    row.applicationId,
    row.appId,
    row.id,
    (row.application as Record<string, unknown> | undefined)?.applicationId,
    (row.data as Record<string, unknown> | undefined)?.applicationId,
  );
}

export async function getStoAppBindingPath(appPath: string): Promise<string> {
  return resolve(appPath);
}
