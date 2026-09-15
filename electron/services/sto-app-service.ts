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
  listCodeApplicationRevisions,
  pullCodeApplication,
  pushCodeApplication,
  resolveCodeApplicationConflict,
  restoreCodeApplicationToRevision,
  type CodeCollabCommandResult,
  type CodeCollabStatusSummary,
} from './code-collab-service';
import type { SourceConflictFile } from '../../shared/site-app-source-merge';
import {
  listSiteAppDeployments,
  rollbackSiteAppDeployment,
} from './site-app-api';
import { readStoWorkspaceFile } from './sto-workspace-store';
import { siteAppRevisionToCheckpoint } from '../../shared/site-app-source-revisions';
import { readStoAppPushHistory } from './sto-app-push-history-store';
import { stoAppPushToCheckpoint } from '../../shared/sto-app-push-history';
import type { SiteAppDeploymentRecord } from '../../shared/site-app-deployments';
import type { SiteAppDeployRollbackResult } from '../../shared/site-app-deployments';

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

export async function listStoAppPushTimeline(appPath: string): Promise<{
  source: 'cloud' | 'local';
  items: Array<{ hash: string; timestamp: number; subject: string; revisionId?: string }>;
}> {
  try {
    const revisions = await listCodeApplicationRevisions(appPath, 50);
    if (revisions.length > 0) {
      return {
        source: 'cloud',
        items: revisions.map((item) => {
          const checkpoint = siteAppRevisionToCheckpoint(item);
          return {
            hash: checkpoint.hash,
            timestamp: checkpoint.timestamp,
            subject: checkpoint.subject,
            revisionId: checkpoint.revisionId,
          };
        }),
      };
    }
  } catch {
    // fall through to local push-history
  }
  const local = await readStoAppPushHistory(appPath);
  return {
    source: 'local',
    items: local.map((item) => {
      const checkpoint = stoAppPushToCheckpoint(item);
      return {
        hash: checkpoint.hash,
        timestamp: checkpoint.timestamp,
        subject: checkpoint.subject,
        revisionId: item.revisionId,
      };
    }),
  };
}

export async function restoreStoAppToRevision(
  appPath: string,
  revisionId: string,
  options?: { push?: boolean; message?: string; workspaceId?: string },
): Promise<StoAppCommandResult> {
  try {
    return toCommandResult(
      await restoreCodeApplicationToRevision(appPath, revisionId, options),
    );
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function listStoAppCloudDeployments(
  appPath: string,
  groupName?: string,
): Promise<SiteAppDeploymentRecord[]> {
  const state = await readStoWorkspaceFile(appPath);
  const appCode = state?.appCode?.trim();
  if (!appCode) throw new Error('未绑定云端应用');
  const { resolveDeployGroupName } = await import('./sto-app-deploy-group');
  const resolved = await resolveDeployGroupName(appPath, groupName);
  if (!resolved) throw new Error('缺少 group_name（DevOps Founder Group）');
  return listSiteAppDeployments({ appCode, groupName: resolved });
}

export async function rollbackStoAppCloudDeployment(
  appPath: string,
  input: { groupName?: string; targetRecordId: number; syncLocal?: boolean },
): Promise<{
  rollback: SiteAppDeployRollbackResult;
  localSync?: StoAppCommandResult | null;
}> {
  const state = await readStoWorkspaceFile(appPath);
  const appCode = state?.appCode?.trim();
  if (!appCode) throw new Error('未绑定云端应用');
  const { resolveDeployGroupName } = await import('./sto-app-deploy-group');
  const groupName = await resolveDeployGroupName(appPath, input.groupName);
  if (!groupName) throw new Error('缺少 group_name（DevOps Founder Group）');
  const rollback = await rollbackSiteAppDeployment({
    appCode,
    groupName,
    targetRecordId: input.targetRecordId,
  });

  let localSync: StoAppCommandResult | null = null;
  if (input.syncLocal !== false && rollback.status === 'success') {
    const matched = rollback.records.find((item) => item.id === input.targetRecordId)
      ?? (await listSiteAppDeployments({ appCode, groupName })
        .then((list) => list.find((item) => item.id === input.targetRecordId))
        .catch(() => undefined));
    const revisionId = matched?.revisionId?.trim();
    if (revisionId) {
      localSync = await restoreStoAppToRevision(appPath, revisionId, {
        push: false,
        message: `同步本地到部署 ${matched?.iterateName || input.targetRecordId}`,
      });
    }
  }

  return { rollback, localSync };
}

export async function getStoAppDeployGroupName(appPath: string): Promise<string | null> {
  const { resolveDeployGroupName } = await import('./sto-app-deploy-group');
  return resolveDeployGroupName(appPath);
}
