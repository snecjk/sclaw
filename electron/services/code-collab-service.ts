/**
 * Site App code collaboration via memory-center HTTP source APIs.
 * List / archive / create / commit / snapshot use `/api/v1/site-apps*`.
 */

import { readFile, realpath, readdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { basename, join, resolve } from 'node:path';
import {
  normalizeSiteAppPageType,
  type SiteAppPageType,
  type SiteAppRecord,
} from '../../shared/site-app-catalog';
import {
  REMOTE_AHEAD_MESSAGE,
  decideSourcePullAction,
  isVersionConflictError,
} from '../../shared/site-app-source-sync';
import type { SourceConflictFile, SourcePullClientAction } from '../../shared/site-app-source-merge';
import { resolveSiteAppGitGroup } from '../../shared/site-app-git-group';
import { setSiteDepartmentTypes } from '../../shared/site-user-utils';
import { siteAppToWorkspaceFields, type StoWorkspaceFile } from '../../shared/sto-workspace';
import { createUlid } from '../utils/ulid';
import { getAuthState } from '../utils/auth-store';
import { logger } from '../utils/logger';
import {
  cleanupSourceSnapshot,
  createSourceSnapshot,
  ensureEmptyDirectory,
  extractSourceArchive,
  applyArchiveToWorkspace,
} from '../utils/code-source-archive';
import {
  applyArchiveFileDiff,
  beginThreeWayMerge,
  cacheBaseSnapshotFromArchive,
  cacheBaseSnapshotFromWorkspace,
  clearMergeState,
  finalizeMergeContinue,
  listUnresolvedConflicts,
  readMergeState,
  resolveMergeConflictChoice,
  workspaceHasConflictMarkers,
} from '../utils/code-source-merge';
import {
  commitSiteAppSource,
  createSiteApp,
  downloadSiteAppSourceSnapshot,
  enrichSiteAppRecord,
  getSiteApp,
  listSiteAppSourceRevisions,
  listSiteApps,
} from './site-app-api';
import { loadSiteDepartmentTypes } from './sto-apollo-config-service';
import {
  getStoAppBindingByLocalPath,
  getStoAppBindingByWorkspaceId,
  upsertStoAppBinding,
} from './sto-app-binding-store';
import { writeAppDevAppCode } from './app-dev-marker';
import { listUserWorkspaces } from './session-catalog-service';
import {
  readStoWorkspaceFile,
  writeStoWorkspaceBinding,
} from './sto-workspace-store';
import { upsertStoAppPushHistory } from './sto-app-push-history-store';
import { StoMemoryApiError } from './sto-memory-api-fetch';

export interface CodeCollabCommandResult {
  ok: boolean;
  output: string;
  json?: unknown;
}

export interface CodeCollabStatusSummary {
  available: boolean;
  executable: string | null;
  bound: boolean;
  syncState: 'unbound' | 'synced' | 'local-changes' | 'remote-ahead' | 'merge-required' | 'unknown';
  syncLabel: string;
  appCode?: string;
  applicationName?: string;
  revisionId?: string;
  remoteRevisionId?: string;
  mergeTheirsRevisionId?: string;
  devCommitSha?: string;
  conflicts?: SourceConflictFile[];
  raw?: unknown;
}

const CODE_COLLAB_LOG_MAX_CHARS = 12_000;
const SOURCE_SYNC_EXECUTABLE = 'site-apps';

function syncLabelForState(state: CodeCollabStatusSummary['syncState'], bound: boolean): string {
  if (!bound) return '未绑定';
  switch (state) {
    case 'synced': return '已同步';
    case 'local-changes': return '本地有改动';
    case 'remote-ahead': return '远端有更新';
    case 'merge-required': return '需要合并';
    default: return '状态未知';
  }
}

function serializeForCodeCollabLog(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= CODE_COLLAB_LOG_MAX_CHARS) return text;
    return `${text.slice(0, CODE_COLLAB_LOG_MAX_CHARS)}…[truncated ${text.length - CODE_COLLAB_LOG_MAX_CHARS} chars]`;
  } catch {
    return '[unserializable]';
  }
}

async function workspaceHasSourceFiles(appPath: string): Promise<boolean> {
  const entries = await readdir(appPath).catch(() => [] as string[]);
  return entries.some((entry) => entry !== '.sto');
}

export async function createSiteApplication(input: {
  applicationName: string;
  description?: string | null;
  pageType?: SiteAppPageType;
}): Promise<SiteAppRecord> {
  const applicationName = input.applicationName.trim();
  if (!applicationName) throw new Error('应用名称不能为空');
  const pageType = normalizeSiteAppPageType(input.pageType);
  return createSiteApp({
    name: applicationName,
    description: input.description,
    pageType,
  });
}

export async function ensureStoWorkspaceBinding(
  appPath: string,
  hints?: { appCode?: string; workspaceId?: string },
): Promise<StoWorkspaceFile | null> {
  const cwd = resolve(appPath);
  const existing = await readStoWorkspaceFile(cwd);
  if (existing) return existing;

  let appCode = hints?.appCode?.trim();
  if (!appCode && hints?.workspaceId) {
    appCode = (await getStoAppBindingByWorkspaceId(hints.workspaceId))?.appCode;
  }
  if (!appCode) {
    appCode = (await getStoAppBindingByLocalPath(cwd))?.appCode;
  }
  if (!appCode) {
    appCode = (await readMarkerForFirstPush(cwd)).appCode;
  }
  if (!appCode) {
    logger.warn(`[code-collab] ensure workspace skip: no appCode appPath=${cwd}`);
    return null;
  }

  let remote: SiteAppRecord | undefined;
  try {
    remote = await enrichSiteAppRecord(await getSiteApp(appCode));
  } catch (err) {
    logger.warn(`[code-collab] ensure workspace detail fallback appPath=${cwd}:`, err);
    const listed = await listSiteApps().catch(() => [] as SiteAppRecord[]);
    remote = listed.find((item) => item.appCode === appCode);
    if (remote) remote = await enrichSiteAppRecord(remote);
  }
  if (remote?.status?.trim().toLowerCase() === 'archived') {
    logger.warn(
      `[code-collab] ensure workspace skip: status not writable appPath=${cwd} status=${remote.status}`,
    );
    return null;
  }

  const written = await writeStoWorkspaceBinding({
    appPath: cwd,
    cloud: siteAppToWorkspaceFields(remote),
    fallback: { appCode, status: remote?.status ?? 'ready' },
  });
  if (written) {
    logger.info(`[code-collab] ensured .sto/workspace.json appPath=${cwd} appCode=${appCode}`);
  }
  return written;
}

async function requireWorkspace(
  appPath: string,
  hints?: { appCode?: string; workspaceId?: string },
): Promise<{ cwd: string; state: StoWorkspaceFile }> {
  const cwd = await realpath(resolve(appPath));
  let state = await readStoWorkspaceFile(cwd);
  if (!state) {
    state = await ensureStoWorkspaceBinding(cwd, hints);
  }
  if (!state) {
    throw new Error('当前目录未绑定 Site App，缺少 .sto/workspace.json');
  }
  if (state.workspacePath !== cwd) {
    throw new Error('workspacePath 与当前目录不一致，请检查 .sto/workspace.json');
  }
  return { cwd, state };
}

async function readMarkerForFirstPush(appPath: string): Promise<{
  applicationName: string;
  description?: string;
  pageType: SiteAppPageType;
  source?: 'created' | 'imported';
  appCode?: string;
}> {
  const fallbackName = basename(appPath);
  try {
    const raw = JSON.parse(
      await readFile(join(appPath, '.sclaw', 'app-dev.json'), 'utf8'),
    ) as Record<string, unknown>;
    const applicationName = typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : fallbackName;
    const source = raw.source === 'created' || raw.source === 'imported'
      ? raw.source
      : undefined;
    const appCode = typeof raw.appCode === 'string' && raw.appCode.trim()
      ? raw.appCode.trim()
      : undefined;
    const description = typeof raw.description === 'string'
      ? raw.description.trim()
      : undefined;
    return {
      applicationName,
      description,
      pageType: normalizeSiteAppPageType(raw.pageType),
      source,
      appCode,
    };
  } catch {
    return { applicationName: fallbackName, pageType: 'site' };
  }
}

export function resolveFirstPushAppDescription(
  applicationName: string,
  description: string | undefined,
): string | null {
  if (description === undefined) return `${applicationName} 应用`;
  return description.trim() || null;
}

async function summarizePendingRegistrationStatus(cwd: string): Promise<CodeCollabStatusSummary> {
  const marker = await readMarkerForFirstPush(cwd);
  let syncState: CodeCollabStatusSummary['syncState'] = 'unknown';
  try {
    const snapshot = await createSourceSnapshot(cwd);
    await cleanupSourceSnapshot(snapshot);
    syncState = 'local-changes';
  } catch {
    syncState = 'unknown';
  }
  return {
    available: true,
    executable: SOURCE_SYNC_EXECUTABLE,
    bound: false,
    syncState,
    syncLabel: '待首次提交',
    appCode: marker.appCode,
    applicationName: marker.applicationName,
    raw: { pendingRegistration: true, source: marker.source ?? 'created' },
  };
}

async function persistFirstPushAppCode(input: {
  appPath: string;
  appCode: string;
  applicationName: string;
  status?: string;
  cloud?: SiteAppRecord;
  workspaceId?: string;
}): Promise<StoWorkspaceFile | null> {
  const appCode = input.appCode.trim();
  if (!appCode) throw new Error('缺少 appCode');
  await writeAppDevAppCode(input.appPath, appCode).catch((err) => {
    logger.warn(`[code-collab] marker appCode write failed appPath=${input.appPath}:`, err);
  });

  const state = await writeStoWorkspaceBinding({
    appPath: input.appPath,
    cloud: input.cloud
      ? {
          appCode: input.cloud.appCode,
          status: input.cloud.status,
        }
      : undefined,
    fallback: { appCode, status: input.status || input.cloud?.status || 'ready' },
  });

  let workspaceId = input.workspaceId?.trim();
  if (!workspaceId) {
    const workspaces = await listUserWorkspaces();
    workspaceId = workspaces.find((item) => resolve(item.rootPath) === resolve(input.appPath))?.id;
  }
  if (workspaceId) {
    await upsertStoAppBinding({
      appCode,
      applicationName: input.applicationName.trim() || appCode,
      localPath: resolve(input.appPath),
      workspaceId,
    }).catch((err) => logger.warn('[code-collab] binding upsert after first-push create failed:', err));
  }
  return state;
}

function isFirstPushBaselineReady(state: StoWorkspaceFile | null): boolean {
  return Boolean(state?.appCode && (state.baseRevisionId || state.baseCommitSha));
}

/**
 * First source/commit only: bind Git Group from SSO identity.
 * Subsequent commits omit group fields so the server reuses the existing binding.
 */
async function resolveGitGroupForFirstCommit(baseRevisionId: string | null | undefined) {
  if (baseRevisionId) return null;
  try {
    const types = await loadSiteDepartmentTypes();
    setSiteDepartmentTypes(types);
  } catch (error) {
    logger.warn('[code-collab] load site department types for git group failed:', error);
  }
  const { user } = await getAuthState();
  const gitGroup = resolveSiteAppGitGroup(user ?? {});
  if (!gitGroup) {
    logger.warn('[code-collab] first commit missing SSO categoryCode/companyCode; omit git group');
  }
  return gitGroup;
}

/**
 * Bind workspace for push. Creates the cloud Site App on first commit only.
 * appCode is persisted immediately after cloud create so a later source-commit
 * failure will reuse the same application instead of creating another one.
 * First source/commit auto-provisions the Git repository on the server.
 */
async function ensureWorkspaceForPush(
  appPath: string,
  hints?: { appCode?: string; workspaceId?: string },
): Promise<{ cwd: string; state: StoWorkspaceFile }> {
  const cwd = await realpath(resolve(appPath));
  const existing = await readStoWorkspaceFile(cwd);
  if (existing && existing.workspacePath !== cwd) {
    throw new Error('workspacePath 与当前目录不一致，请检查 .sto/workspace.json');
  }
  if (isFirstPushBaselineReady(existing)) {
    return { cwd, state: existing! };
  }

  const fromBinding = existing ?? await ensureStoWorkspaceBinding(cwd, hints);
  const marker = await readMarkerForFirstPush(cwd);
  const { applicationName, pageType } = marker;
  let appCode = fromBinding?.appCode || marker.appCode || hints?.appCode?.trim();
  let cloud: SiteAppRecord | undefined;

  if (!appCode) {
    logger.info(
      `[code-collab] first-push create cloud app name=${applicationName} pageType=${pageType} appPath=${cwd}`,
    );
    cloud = await createSiteApp({
      name: applicationName,
      description: resolveFirstPushAppDescription(applicationName, marker.description),
      pageType,
    });
    appCode = cloud.appCode;
    await persistFirstPushAppCode({
      appPath: cwd,
      appCode,
      applicationName: cloud.applicationName || applicationName,
      status: cloud.status || 'ready',
      cloud,
      workspaceId: hints?.workspaceId,
    });
  } else if (!fromBinding?.baseRevisionId && !fromBinding?.baseCommitSha) {
    logger.info(
      `[code-collab] first-push reuse cloud app appCode=${appCode} name=${applicationName} appPath=${cwd}`,
    );
    try {
      cloud = await getSiteApp(appCode);
    } catch (error) {
      logger.warn(`[code-collab] first-push detail fallback appCode=${appCode}:`, error);
    }
  }

  const state = await persistFirstPushAppCode({
    appPath: cwd,
    appCode,
    applicationName: cloud?.applicationName || applicationName,
    status: cloud?.status || 'ready',
    cloud,
    workspaceId: hints?.workspaceId,
  });
  if (!state) {
    throw new Error('首次提交：云端应用已创建，但未能写入 .sto/workspace.json');
  }
  return { cwd, state };
}

function throwIfRemoteAhead(state: StoWorkspaceFile, remote?: SiteAppRecord | null): void {
  const remoteRevision = remote?.headRevisionId ?? null;
  const localRevision = state.baseRevisionId ?? null;
  if (remoteRevision && localRevision && remoteRevision !== localRevision) {
    throw new Error(REMOTE_AHEAD_MESSAGE);
  }
}

function mapVersionConflict(error: unknown): never {
  if (error instanceof StoMemoryApiError && isVersionConflictError(error.errCode)) {
    throw new Error(REMOTE_AHEAD_MESSAGE);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function localSourceSha256(cwd: string): Promise<string | null> {
  try {
    const snapshot = await createSourceSnapshot(cwd);
    await cleanupSourceSnapshot(snapshot);
    return snapshot.sourceSha256;
  } catch {
    return null;
  }
}

async function updateWorkspaceBaseline(
  appPath: string,
  appCode: string,
  revision: { revisionId: string; commitSha: string; sourceSha256: string },
  mergeParentRevisionId?: string | null,
): Promise<void> {
  await writeStoWorkspaceBinding({
    appPath,
    cloud: {
      appCode,
      status: 'ready',
      baseRevisionId: revision.revisionId,
      baseCommitSha: revision.commitSha,
      baseSourceSha256: revision.sourceSha256,
    },
    fallback: { appCode, status: 'ready' },
    mergeParentRevisionId: mergeParentRevisionId === undefined ? undefined : mergeParentRevisionId,
  });
}

export async function getCodeCollabStatus(appPath: string): Promise<CodeCollabStatusSummary> {
  const cwd = resolve(appPath);
  logger.info(`[code-collab] action=status appPath=${cwd}`);
  try {
    const { state } = await requireWorkspace(cwd);
    let remote: SiteAppRecord | undefined;
    try {
      remote = await getSiteApp(state.appCode);
    } catch (error) {
      logger.warn(`[code-collab] action=status detail fallback appCode=${state.appCode}:`, error);
    }

    const mergeState = await readMergeState(cwd);
    const conflicts = (await listUnresolvedConflicts(cwd))
      .filter((item) => item.path !== '(conflict-markers)');
    const markerConflicts = await workspaceHasConflictMarkers(cwd);

    let syncState: CodeCollabStatusSummary['syncState'] = 'unknown';
    const remoteRev = remote?.headRevisionId ?? null;
    const remoteCommit = remote?.headCommitSha ?? null;
    const localRev = state.baseRevisionId ?? null;
    const localCommit = state.baseCommitSha ?? null;
    const remoteChanged = Boolean(
      (remoteRev && localRev && remoteRev !== localRev)
      || (remoteCommit && localCommit && remoteCommit !== localCommit)
      || (remoteRev && !localRev),
    );
    const localSha = await localSourceSha256(cwd);
    const localChanged = Boolean(
      localSha && state.baseSourceSha256 && localSha !== state.baseSourceSha256,
    );

    if (mergeState || conflicts.length > 0 || markerConflicts) {
      syncState = 'merge-required';
    } else if (remoteChanged && localChanged) {
      syncState = 'merge-required';
    } else if (remoteChanged) {
      syncState = 'remote-ahead';
    } else if (localChanged) {
      syncState = 'local-changes';
    } else if (localRev) {
      syncState = 'synced';
    }

    const summary: CodeCollabStatusSummary = {
      available: true,
      executable: SOURCE_SYNC_EXECUTABLE,
      bound: true,
      syncState,
      syncLabel: syncLabelForState(syncState, true),
      appCode: state.appCode,
      applicationName: remote?.applicationName,
      revisionId: state.baseRevisionId ?? undefined,
      remoteRevisionId: remote?.headRevisionId ?? undefined,
      mergeTheirsRevisionId: mergeState?.theirsRevisionId ?? remote?.headRevisionId ?? undefined,
      devCommitSha: state.baseCommitSha ?? undefined,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
      raw: { local: state, remote, mergeState },
    };
    logger.info(`[code-collab] action=status syncState=${summary.syncState} appCode=${summary.appCode}`);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const marker = await readMarkerForFirstPush(cwd);
      if (marker.source === 'created') {
        const pending = await summarizePendingRegistrationStatus(cwd);
        logger.info(
          `[code-collab] action=status pendingRegistration appPath=${cwd} syncState=${pending.syncState}`,
        );
        return pending;
      }
    } catch {
      // fall through to generic unbound
    }
    return {
      available: true,
      executable: SOURCE_SYNC_EXECUTABLE,
      bound: false,
      syncState: 'unbound',
      syncLabel: '未绑定',
      raw: message,
    };
  }
}

export async function pushCodeApplication(
  appPath: string,
  message: string,
  hints?: { workspaceId?: string },
): Promise<CodeCollabCommandResult> {
  const trimmed = message.trim() || '更新应用';
  const { cwd, state } = await ensureWorkspaceForPush(appPath, hints);
  logger.info(
    `[code-collab] action=push start appPath=${cwd} message=${JSON.stringify(trimmed)} workspace=${serializeForCodeCollabLog({
      appCode: state.appCode,
      baseRevisionId: state.baseRevisionId,
      baseCommitSha: state.baseCommitSha,
      baseSourceSha256: state.baseSourceSha256,
      mergeParentRevisionId: state.mergeParentRevisionId,
    })}`,
  );

  const mergeState = await readMergeState(cwd);
  if (mergeState) {
    throw new Error('请先处理冲突并继续合并');
  }
  const unresolved = await listUnresolvedConflicts(cwd);
  if (unresolved.length > 0 || await workspaceHasConflictMarkers(cwd)) {
    throw new Error('还有未解决的冲突，无法提交');
  }

  try {
    const remote = await getSiteApp(state.appCode);
    throwIfRemoteAhead(state, remote);
  } catch (error) {
    if (error instanceof Error && error.message === REMOTE_AHEAD_MESSAGE) throw error;
    logger.warn(`[code-collab] action=push remote check fallback:`, error);
  }

  const revisionId = createUlid();
  const snapshot = await createSourceSnapshot(cwd);
  const gitGroup = await resolveGitGroupForFirstCommit(state.baseRevisionId);
  logger.info(
    `[code-collab] action=push snapshot revisionId=${revisionId} ${serializeForCodeCollabLog({
      archivePath: snapshot.archivePath,
      sourceSha256: snapshot.sourceSha256,
      archiveSha256: snapshot.archiveSha256,
      archiveSizeBytes: snapshot.archiveSizeBytes,
      expandedSizeBytes: snapshot.expandedSizeBytes,
      fileCount: snapshot.fileCount,
      gitGroup: gitGroup ?? null,
    })}`,
  );

  try {
    const revision = await commitSiteAppSource({
      appCode: state.appCode,
      archivePath: snapshot.archivePath,
      metadata: {
        revisionId,
        revisionMessage: trimmed,
        baseRevisionId: state.baseRevisionId,
        parentRevisionId: state.baseRevisionId,
        mergeParentRevisionId: state.mergeParentRevisionId,
        sourceSha256: snapshot.sourceSha256,
        archiveSha256: snapshot.archiveSha256,
        archiveSizeBytes: snapshot.archiveSizeBytes,
        expandedSizeBytes: snapshot.expandedSizeBytes,
        fileCount: snapshot.fileCount,
      },
      gitGroup,
    }).catch(mapVersionConflict);

    if (revision.status.toLowerCase() !== 'ready' || !revision.commitSha) {
      throw new Error('代码版本未成功写入 dev 分支');
    }
    if (revision.sourceSha256 !== snapshot.sourceSha256) {
      throw new Error('上传校验失败：sourceSha256 不一致');
    }
    if (revision.archiveSha256 !== snapshot.archiveSha256) {
      throw new Error('上传校验失败：archiveSha256 不一致');
    }
    if (revision.fileCount != null && revision.fileCount !== snapshot.fileCount) {
      throw new Error('上传校验失败：fileCount 不一致');
    }

    await updateWorkspaceBaseline(cwd, state.appCode, {
      revisionId: revision.revisionId,
      commitSha: revision.commitSha,
      sourceSha256: snapshot.sourceSha256,
    }, null);
    await cacheBaseSnapshotFromWorkspace(cwd).catch((err) => {
      logger.warn('[code-collab] base snapshot cache after push failed:', err);
    });
    await upsertStoAppPushHistory(cwd, {
      revisionId: revision.revisionId,
      appCode: state.appCode,
      message: trimmed,
      commitSha: revision.commitSha,
      createdAt: Date.now(),
    }).catch((err) => logger.warn('[code-collab] push history write failed:', err));
    logger.info(`[code-collab] action=push success revisionId=${revision.revisionId}`);
    return { ok: true, output: '提交成功', json: revision };
  } finally {
    await cleanupSourceSnapshot(snapshot);
  }
}

export async function pullCodeApplication(appPath: string): Promise<CodeCollabCommandResult> {
  const { cwd, state } = await requireWorkspace(appPath);
  logger.info(`[code-collab] action=pull appPath=${cwd}`);
  const localSha = await localSourceSha256(cwd);
  const { archive, remote } = await downloadSiteAppSourceSnapshot(state.appCode);
  gunzipSync(archive);

  const decision = decideSourcePullAction({
    base: {
      revisionId: state.baseRevisionId,
      commitSha: state.baseCommitSha,
      sourceSha256: state.baseSourceSha256,
    },
    localSourceSha256: localSha,
    remote,
    workspaceEmpty: !(await workspaceHasSourceFiles(cwd)),
  });
  logger.info(`[code-collab] action=pull decision=${decision} appCode=${state.appCode}`);

  if (decision === 'already-synced') {
    return {
      ok: true,
      output: '已是最新',
      json: { action: 'already-synced' satisfies SourcePullClientAction, remote },
    };
  }
  if (decision === 'local-ahead') {
    return {
      ok: true,
      output: '本地已有未提交改动，未覆盖本地代码。请直接提交。',
      json: { action: 'local-ahead' satisfies SourcePullClientAction, remote },
    };
  }

  if (decision === 'diverged') {
    if (!state.baseRevisionId) {
      throw new Error('本地和远端都有更新，但缺少本地基线，无法自动合并');
    }
    const merge = await beginThreeWayMerge({
      workspace: cwd,
      remoteArchive: archive,
      oursBaseRevisionId: state.baseRevisionId,
      theirsRevisionId: remote.revisionId,
      theirsCommitSha: remote.commitSha,
      theirsSourceSha256: remote.sourceSha256,
    });
    if (merge.conflicts.length > 0) {
      logger.info(
        `[code-collab] action=pull conflicts count=${merge.conflicts.length} appCode=${state.appCode}`,
      );
      return {
        ok: true,
        output: `有 ${merge.conflicts.length} 个文件需要处理`,
        json: {
          action: 'conflicts' satisfies SourcePullClientAction,
          remote,
          conflicts: merge.conflicts,
        },
      };
    }
    await updateWorkspaceBaseline(cwd, state.appCode, {
      revisionId: remote.revisionId,
      commitSha: remote.commitSha,
      sourceSha256: remote.sourceSha256,
    }, state.baseRevisionId);
    await clearMergeState(cwd);
    await cacheBaseSnapshotFromArchive(archive, cwd).catch((err) => {
      logger.warn('[code-collab] base snapshot cache after merge failed:', err);
    });
    logger.info(`[code-collab] action=pull merged appCode=${state.appCode}`);
    return {
      ok: true,
      output: '已合并远端更新，请检查后提交',
      json: { action: 'merged' satisfies SourcePullClientAction, remote },
    };
  }

  // remote-ahead or initialize on empty workspace
  await applyArchiveFileDiff(archive, cwd);
  const appliedSha = await localSourceSha256(cwd);
  if (appliedSha !== remote.sourceSha256) {
    throw new Error('拉取校验失败：本地源码摘要与远端不一致');
  }
  await updateWorkspaceBaseline(cwd, state.appCode, {
    revisionId: remote.revisionId,
    commitSha: remote.commitSha,
    sourceSha256: remote.sourceSha256,
  }, null);
  await cacheBaseSnapshotFromArchive(archive, cwd).catch((err) => {
    logger.warn('[code-collab] base snapshot cache after pull failed:', err);
  });
  logger.info(`[code-collab] action=pull success appCode=${state.appCode}`);
  return {
    ok: true,
    output: '拉取成功',
    json: { action: 'applied' satisfies SourcePullClientAction, remote },
  };
}

export async function cloneCodeApplication(
  appCode: string,
  targetDir: string,
): Promise<CodeCollabCommandResult> {
  const code = appCode.trim();
  const target = resolve(targetDir.trim());
  if (!code) throw new Error('缺少 appCode');
  if (!target) throw new Error('缺少目标目录');
  logger.info(`[code-collab] action=clone appCode=${code} targetDir=${target}`);
  await ensureEmptyDirectory(target);
  const { archive, remote } = await downloadSiteAppSourceSnapshot(code);
  gunzipSync(archive);
  await extractSourceArchive(archive, target);
  const appliedSha = await localSourceSha256(target);
  if (appliedSha !== remote.sourceSha256) {
    throw new Error('克隆校验失败：本地源码摘要与远端不一致');
  }
  await updateWorkspaceBaseline(target, code, {
    revisionId: remote.revisionId,
    commitSha: remote.commitSha,
    sourceSha256: remote.sourceSha256,
  }, null);
  await cacheBaseSnapshotFromArchive(archive, target).catch((err) => {
    logger.warn('[code-collab] base snapshot cache after clone failed:', err);
  });
  logger.info(`[code-collab] action=clone success appCode=${code} targetDir=${target}`);
  return {
    ok: true,
    output: '拉取成功',
    json: { appCode: code, workspacePath: target, remote },
  };
}

export async function continueCodeApplicationMerge(
  appPath: string,
  revisionId: string,
): Promise<CodeCollabCommandResult> {
  const { cwd, state } = await requireWorkspace(appPath);
  const mergeState = await finalizeMergeContinue(cwd);
  const expected = mergeState.theirsRevisionId;
  const requested = revisionId.trim();
  if (requested && requested !== expected && requested !== state.baseRevisionId) {
    throw new Error(`合并版本不匹配：期望 ${expected}`);
  }
  await updateWorkspaceBaseline(cwd, state.appCode, {
    revisionId: mergeState.theirsRevisionId,
    commitSha: mergeState.theirsCommitSha,
    sourceSha256: mergeState.theirsSourceSha256,
  }, mergeState.oursBaseRevisionId);
  await clearMergeState(cwd);
  await cacheBaseSnapshotFromWorkspace(cwd).catch((err) => {
    logger.warn('[code-collab] base snapshot cache after continue failed:', err);
  });
  logger.info(
    `[code-collab] action=merge-continue success appCode=${state.appCode} theirs=${mergeState.theirsRevisionId}`,
  );
  return {
    ok: true,
    output: '冲突已处理，可以提交',
    json: {
      action: 'merged',
      remote: {
        revisionId: mergeState.theirsRevisionId,
        commitSha: mergeState.theirsCommitSha,
        sourceSha256: mergeState.theirsSourceSha256,
      },
    },
  };
}

export async function listCodeApplicationConflicts(
  appPath: string,
): Promise<SourceConflictFile[]> {
  const { cwd } = await requireWorkspace(appPath);
  return (await listUnresolvedConflicts(cwd))
    .filter((item) => item.path !== '(conflict-markers)');
}

export async function resolveCodeApplicationConflict(
  appPath: string,
  path: string,
  choice: 'ours' | 'theirs',
): Promise<SourceConflictFile[]> {
  const { cwd } = await requireWorkspace(appPath);
  return resolveMergeConflictChoice({ workspace: cwd, path, choice });
}

/**
 * Restore local workspace to a cloud source revision snapshot, then optionally
 * push a new commit so cloud HEAD also returns to that content (revert-style).
 *
 * Push must base on current remote HEAD (not the historical revision), otherwise
 * the server rejects with VERSION_CONFLICT.
 */
export async function restoreCodeApplicationToRevision(
  appPath: string,
  revisionId: string,
  options?: { push?: boolean; message?: string; workspaceId?: string },
): Promise<CodeCollabCommandResult> {
  const targetRevisionId = revisionId.trim();
  if (!targetRevisionId) throw new Error('缺少 revisionId');
  const { cwd, state } = await requireWorkspace(appPath);
  const mergeState = await readMergeState(cwd);
  if (mergeState) throw new Error('请先处理冲突并继续合并');

  logger.info(
    `[code-collab] action=restore-revision start appPath=${cwd} revisionId=${targetRevisionId} push=${Boolean(options?.push)}`,
  );

  let headRemote: SiteAppRecord | null = null;
  try {
    headRemote = await getSiteApp(state.appCode);
  } catch (error) {
    logger.warn('[code-collab] restore-revision head detail fallback:', error);
  }

  const { archive, remote } = await downloadSiteAppSourceSnapshot(state.appCode, {
    revisionId: targetRevisionId,
  });
  await applyArchiveToWorkspace(archive, cwd);

  const pushBaseRevisionId = headRemote?.headRevisionId ?? state.baseRevisionId;
  const pushBaseCommitSha = headRemote?.headCommitSha ?? state.baseCommitSha;
  const pushBaseSourceSha = headRemote?.headSourceSha256 ?? state.baseSourceSha256;

  // Local working tree matches historical content; baseline stays at HEAD so a
  // subsequent commit is accepted as a forward revert.
  if (pushBaseRevisionId && pushBaseCommitSha && pushBaseSourceSha) {
    await updateWorkspaceBaseline(cwd, state.appCode, {
      revisionId: pushBaseRevisionId,
      commitSha: pushBaseCommitSha,
      sourceSha256: pushBaseSourceSha,
    }, null);
  }
  // Keep base-snapshot aligned with baseline (HEAD), not the historical tree.
  if (options?.push) {
    // pushCodeApplication will refresh baseline + cache after commit.
  } else if (pushBaseRevisionId && pushBaseRevisionId !== remote.revisionId) {
    try {
      const headSnap = await downloadSiteAppSourceSnapshot(state.appCode);
      await cacheBaseSnapshotFromArchive(headSnap.archive, cwd);
    } catch (error) {
      logger.warn('[code-collab] HEAD base snapshot after restore-revision failed:', error);
    }
  } else {
    await cacheBaseSnapshotFromArchive(archive, cwd).catch((err) => {
      logger.warn('[code-collab] base snapshot cache after restore-revision failed:', err);
    });
  }
  try {
    const { createCheckpoint } = await import('./app-dev-service');
    await createCheckpoint(cwd, `本地恢复到 ${targetRevisionId.slice(0, 8)}`);
  } catch (error) {
    logger.warn('[code-collab] local checkpoint after restore-revision failed:', error);
  }

  if (options?.push) {
    const message = options.message?.trim()
      || `恢复到修订 ${remote.revisionId.slice(0, 8)}`;
    return pushCodeApplication(cwd, message, { workspaceId: options.workspaceId });
  }

  return {
    ok: true,
    output: '已恢复本地源码到所选云端修订（未推送到云端）',
    json: {
      action: 'restored-local',
      revisionId: remote.revisionId,
      commitSha: remote.commitSha,
      baseRevisionId: pushBaseRevisionId,
    },
  };
}

export async function listCodeApplicationRevisions(appPath: string, limit = 50) {
  const { state } = await requireWorkspace(appPath);
  return listSiteAppSourceRevisions(state.appCode, limit);
}
