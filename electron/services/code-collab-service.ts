/**
 * Site App code collaboration via sai-cli `siteapp` commands.
 * List / archive use memory-center HTTP in site-app-api.ts.
 */

import { readFile, realpath, unlink } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { basename, join, resolve } from 'node:path';
import {
  mergeSiteAppRecords,
  normalizeSiteAppPageType,
  type SiteAppPageType,
  type SiteAppRecord,
} from '../../shared/site-app-catalog';
import {
  filePathFromSiteappLocalUri,
  parseSiteappSavedFiles,
  parseSiteappRevision,
  siteappCliErrorMessage,
  type SiteappRepositoryProvision,
} from '../../shared/siteapp-cli-payload';
import { siteAppToWorkspaceFields, type StoWorkspaceFile } from '../../shared/sto-workspace';
import { createUlid } from '../utils/ulid';
import { logger } from '../utils/logger';
import {
  parseSiteappUploadRevision,
  siteappApplicationCreate,
  siteappRepositoryProvision,
  siteappRevisionCreate,
  siteappSourceDownload,
  siteappSourceUpload,
} from '../utils/siteapp-cli';
import {
  applyArchiveToWorkspace,
  cleanupSourceSnapshot,
  createSourceSnapshot,
  ensureEmptyDirectory,
  extractSourceArchive,
} from '../utils/code-source-archive';
import { enrichSiteAppRecord, getSiteApp, listSiteApps } from './site-app-api';
import {
  getStoAppBindingByLocalPath,
  getStoAppBindingByWorkspaceId,
  upsertStoAppBinding,
} from './sto-app-binding-store';
import { listUserWorkspaces } from './session-catalog-service';
import {
  readStoWorkspaceFile,
  writeStoWorkspaceBinding,
} from './sto-workspace-store';

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
  devCommitSha?: string;
  raw?: unknown;
}

const CODE_COLLAB_LOG_MAX_CHARS = 12_000;

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

function isRepositoryReady(status?: string, headCommitSha?: string | null): boolean {
  return status?.trim().toLowerCase() === 'ready' && Boolean(headCommitSha?.trim());
}

async function provisionRepository(appCode: string): Promise<SiteappRepositoryProvision> {
  const provisioned = await siteappRepositoryProvision(appCode);
  if (!isRepositoryReady(provisioned.status, provisioned.headCommitSha)) {
    throw new Error(
      `仓库未就绪（status=${provisioned.status ?? '未知'}），请针对同一 app_code 重试 provision`,
    );
  }
  return provisioned;
}

function siteAppFromProvision(
  appCode: string,
  provisioned: SiteappRepositoryProvision,
  name?: string,
  pageType: SiteAppPageType = 'site',
): SiteAppRecord {
  return {
    appCode,
    applicationName: name ?? appCode,
    status: provisioned.status,
    headRevisionId: provisioned.headRevisionId ?? undefined,
    headCommitSha: provisioned.headCommitSha ?? undefined,
    gitlabProjectId: provisioned.gitlabProjectId,
    devopsApplicationId: provisioned.devopsApplicationId,
    pageType: normalizeSiteAppPageType(pageType),
  };
}

export async function createSiteApplication(input: {
  applicationName: string;
  description?: string | null;
  pageType?: SiteAppPageType;
}): Promise<SiteAppRecord> {
  const applicationName = input.applicationName.trim();
  if (!applicationName) throw new Error('应用名称不能为空');
  const pageType = normalizeSiteAppPageType(input.pageType);
  const created = await siteappApplicationCreate({
    name: applicationName,
    description: input.description,
    pageType,
  });
  const provisioned = await provisionRepository(created.appCode);
  return siteAppFromProvision(
    created.appCode,
    provisioned,
    applicationName,
    created.pageType ?? pageType,
  );
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
  if (!remote || remote.status?.trim().toLowerCase() === 'archived') {
    logger.warn(
      `[code-collab] ensure workspace skip: status not writable appPath=${cwd} status=${remote?.status ?? '-'}`,
    );
    return null;
  }

  const written = await writeStoWorkspaceBinding({
    appPath: cwd,
    cloud: siteAppToWorkspaceFields(remote),
    fallback: { appCode, status: remote.status ?? 'ready' },
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
  pageType: SiteAppPageType;
  source?: 'created' | 'imported';
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
    return {
      applicationName,
      pageType: normalizeSiteAppPageType(raw.pageType),
      source,
    };
  } catch {
    return { applicationName: fallbackName, pageType: 'site' };
  }
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
    executable: 'sai-cli',
    bound: false,
    syncState,
    syncLabel: '待首次提交',
    applicationName: marker.applicationName,
    raw: { pendingRegistration: true, source: marker.source ?? 'created' },
  };
}

/**
 * Bind workspace for push. Creates the cloud Site App on first commit only.
 */
async function ensureWorkspaceForPush(
  appPath: string,
  hints?: { appCode?: string; workspaceId?: string },
): Promise<{ cwd: string; state: StoWorkspaceFile }> {
  const cwd = await realpath(resolve(appPath));
  const existing = await readStoWorkspaceFile(cwd);
  if (existing) {
    if (existing.workspacePath !== cwd) {
      throw new Error('workspacePath 与当前目录不一致，请检查 .sto/workspace.json');
    }
    return { cwd, state: existing };
  }

  const fromBinding = await ensureStoWorkspaceBinding(cwd, hints);
  if (fromBinding) return { cwd, state: fromBinding };

  const { applicationName, pageType } = await readMarkerForFirstPush(cwd);
  logger.info(
    `[code-collab] first-push create cloud app name=${applicationName} pageType=${pageType} appPath=${cwd}`,
  );
  const created = await createSiteApplication({
    applicationName,
    description: `${applicationName} 应用`,
    pageType,
  });

  const state = await writeStoWorkspaceBinding({
    appPath: cwd,
    cloud: siteAppToWorkspaceFields(created),
    fallback: { appCode: created.appCode, status: created.status ?? 'ready' },
  });
  if (!state) {
    throw new Error('首次提交：云端应用已创建，但未能写入 .sto/workspace.json');
  }

  let workspaceId = hints?.workspaceId?.trim();
  if (!workspaceId) {
    const workspaces = await listUserWorkspaces();
    workspaceId = workspaces.find((item) => resolve(item.rootPath) === cwd)?.id;
  }
  if (workspaceId) {
    await upsertStoAppBinding({
      appCode: created.appCode,
      applicationName: created.applicationName || applicationName,
      localPath: cwd,
      workspaceId,
    }).catch((err) => logger.warn('[code-collab] binding upsert after first-push create failed:', err));
  }

  return { cwd, state };
}

function assertRemoteBaseline(
  state: StoWorkspaceFile,
  provisioned: SiteappRepositoryProvision,
): void {
  const remoteRevision = provisioned.headRevisionId ?? null;
  const localRevision = state.baseRevisionId ?? null;
  if (remoteRevision && localRevision && remoteRevision !== localRevision) {
    throw new Error('REMOTE_AHEAD：请先下载远程最新代码并处理差异');
  }
  if (remoteRevision && !localRevision) {
    throw new Error('REMOTE_AHEAD：请先下载远程最新代码并处理差异');
  }
}

async function downloadArchiveBuffer(appCode: string): Promise<Buffer> {
  logger.info(`[code-collab] siteapp download appCode=${appCode}`);
  const result = await siteappSourceDownload(appCode);
  if (!result.ok) throw new Error(siteappCliErrorMessage(result));
  const saved = parseSiteappSavedFiles(result.data);
  if (saved.length === 0) throw new Error('下载失败：CLI 未返回文件路径');
  const path = filePathFromSiteappLocalUri(saved[0].localPath);
  const archive = await readFile(path);
  await unlink(path).catch(() => undefined);
  if (archive.length === 0) throw new Error('下载文件为空');
  gunzipSync(archive);
  return archive;
}

async function updateWorkspaceBaseline(
  appPath: string,
  appCode: string,
  revision: { revisionId: string; commitSha: string; sourceSha256: string },
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
  });
}

export async function getCodeCollabStatus(appPath: string): Promise<CodeCollabStatusSummary> {
  const cwd = resolve(appPath);
  logger.info(`[code-collab] action=status appPath=${cwd}`);
  try {
    const { state } = await requireWorkspace(cwd);
    const provisioned = await siteappRepositoryProvision(state.appCode);
    let remote = siteAppFromProvision(state.appCode, provisioned);
    try {
      const detail = await getSiteApp(state.appCode);
      remote = mergeSiteAppRecords(remote, detail);
    } catch {
      // HTTP detail is optional for status display.
    }

    let syncState: CodeCollabStatusSummary['syncState'] = 'unknown';
    const remoteRev = provisioned.headRevisionId ?? null;
    const localRev = state.baseRevisionId ?? null;
    if (remoteRev && localRev && remoteRev !== localRev) {
      syncState = 'remote-ahead';
    } else {
      try {
        const snapshot = await createSourceSnapshot(cwd);
        await cleanupSourceSnapshot(snapshot);
        if (state.baseSourceSha256 && snapshot.sourceSha256 !== state.baseSourceSha256) {
          syncState = 'local-changes';
        } else {
          syncState = 'synced';
        }
      } catch {
        syncState = localRev ? 'synced' : 'unknown';
      }
    }

    const summary: CodeCollabStatusSummary = {
      available: true,
      executable: 'sai-cli',
      bound: true,
      syncState,
      syncLabel: syncLabelForState(syncState, true),
      appCode: state.appCode,
      applicationName: remote.applicationName,
      revisionId: state.baseRevisionId ?? undefined,
      devCommitSha: state.baseCommitSha ?? undefined,
      raw: { local: state, remote, provisioned },
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
      executable: 'sai-cli',
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
  const provisioned = await provisionRepository(state.appCode);
  logger.info(`[code-collab] action=push provisioned ${serializeForCodeCollabLog(provisioned)}`);
  assertRemoteBaseline(state, provisioned);

  const revisionId = createUlid();
  const snapshot = await createSourceSnapshot(cwd);
  logger.info(
    `[code-collab] action=push snapshot revisionId=${revisionId} ${serializeForCodeCollabLog({
      archivePath: snapshot.archivePath,
      sourceSha256: snapshot.sourceSha256,
      archiveSha256: snapshot.archiveSha256,
      archiveSizeBytes: snapshot.archiveSizeBytes,
      expandedSizeBytes: snapshot.expandedSizeBytes,
      fileCount: snapshot.fileCount,
    })}`,
  );

  try {
    const revisionParams: Record<string, string> = {
      app_code: state.appCode,
      revision_id: revisionId,
      revision_message: trimmed,
      source_sha256: snapshot.sourceSha256,
      archive_sha256: snapshot.archiveSha256,
      archive_size_bytes: String(snapshot.archiveSizeBytes),
      expanded_size_bytes: String(snapshot.expandedSizeBytes),
      file_count: String(snapshot.fileCount),
    };
    if (state.baseRevisionId) {
      revisionParams.base_revision_id = state.baseRevisionId;
      revisionParams.parent_revision_id = state.baseRevisionId;
    }
    logger.info(`[code-collab] action=push revision.create params=${serializeForCodeCollabLog(revisionParams)}`);
    const created = await siteappRevisionCreate(revisionParams);
    if (!created.ok) throw new Error(siteappCliErrorMessage(created));

    const uploadInput = {
      appCode: state.appCode,
      revisionId,
      sourceFile: snapshot.archivePath,
    };
    logger.info(`[code-collab] action=push source.upload input=${serializeForCodeCollabLog(uploadInput)}`);
    const uploaded = await siteappSourceUpload(uploadInput);
    if (!uploaded.ok) throw new Error(siteappCliErrorMessage(uploaded));

    const revision = parseSiteappUploadRevision(uploaded.data);
    logger.info(`[code-collab] action=push source.upload parsed=${serializeForCodeCollabLog(revision)}`);
    if (!revision || revision.status?.toLowerCase() !== 'ready' || !revision.commitSha) {
      throw new Error(revision?.failureMessage || '代码版本未成功写入 dev 分支');
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
      revisionId,
      commitSha: revision.commitSha,
      sourceSha256: snapshot.sourceSha256,
    });
    logger.info(`[code-collab] action=push success revisionId=${revisionId}`);
    return { ok: true, output: '提交成功', json: revision };
  } finally {
    await cleanupSourceSnapshot(snapshot);
  }
}

export async function pullCodeApplication(appPath: string): Promise<CodeCollabCommandResult> {
  const { cwd, state } = await requireWorkspace(appPath);
  logger.info(`[code-collab] action=pull appPath=${cwd}`);
  const before = await siteappRepositoryProvision(state.appCode);
  if (!isRepositoryReady(before.status, before.headCommitSha)) {
    throw new Error(`应用不可拉取，当前仓库状态：${before.status ?? '未知'}`);
  }
  const archive = await downloadArchiveBuffer(state.appCode);
  const after = await siteappRepositoryProvision(state.appCode);
  if (before.headRevisionId !== after.headRevisionId || before.headCommitSha !== after.headCommitSha) {
    throw new Error('下载过程中远端发生更新，请重试拉取');
  }
  await applyArchiveToWorkspace(archive, cwd);
  await writeStoWorkspaceBinding({
    appPath: cwd,
    cloud: {
      appCode: state.appCode,
      status: 'ready',
      baseRevisionId: after.headRevisionId ?? null,
      baseCommitSha: after.headCommitSha ?? null,
      baseSourceSha256: after.headSourceSha256 ?? state.baseSourceSha256 ?? null,
    },
    fallback: { appCode: state.appCode, status: 'ready' },
  });
  const remote = siteAppFromProvision(state.appCode, after);
  logger.info(`[code-collab] action=pull success appCode=${state.appCode}`);
  return { ok: true, output: '拉取成功', json: remote };
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
  const before = await siteappRepositoryProvision(code);
  if (!isRepositoryReady(before.status, before.headCommitSha)) {
    throw new Error(`应用不可克隆，当前仓库状态：${before.status ?? '未知'}`);
  }
  const archive = await downloadArchiveBuffer(code);
  const after = await siteappRepositoryProvision(code);
  if (before.headRevisionId !== after.headRevisionId || before.headCommitSha !== after.headCommitSha) {
    throw new Error('下载过程中远端发生更新，请重试克隆');
  }
  await extractSourceArchive(archive, target);
  await writeStoWorkspaceBinding({
    appPath: target,
    cloud: {
      appCode: code,
      status: 'ready',
      baseRevisionId: after.headRevisionId ?? null,
      baseCommitSha: after.headCommitSha ?? null,
      baseSourceSha256: after.headSourceSha256 ?? null,
    },
    fallback: { appCode: code, status: 'ready' },
  });
  const remote = siteAppFromProvision(code, after);
  logger.info(`[code-collab] action=clone success appCode=${code} targetDir=${target}`);
  return {
    ok: true,
    output: '拉取成功',
    json: { appCode: code, workspacePath: target, application: remote },
  };
}

export async function continueCodeApplicationMerge(
  _appPath: string,
  _revisionId: string,
): Promise<CodeCollabCommandResult> {
  throw new Error('当前版本暂不支持 merge continue，请先手动处理冲突后重新拉取并提交');
}
