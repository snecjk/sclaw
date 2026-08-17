/**
 * STO code-application collaboration via sai-cli (upload / download / status).
 * List, create, and offline remain HTTP in code-application-api.ts.
 */

import { readFile, realpath } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { basename, resolve } from 'node:path';
import {
  type CodeApplicationRecord,
} from '../../shared/code-application-catalog';
import {
  filePathFromSaiLocalUri,
  parseSaiCodeApplicationDetail,
  parseSaiCodeRevision,
  parseSaiDownloadSavedFiles,
  saiCliErrorMessage,
} from '../../shared/sai-policy-payload';
import { codeApplicationToWorkspaceFields, type StoWorkspaceFile } from '../../shared/sto-workspace';
import { createUlid } from '../utils/ulid';
import { logger } from '../utils/logger';
import { runSaiPolicy } from '../utils/sai-cli';
import {
  applyArchiveToWorkspace,
  cleanupSourceSnapshot,
  createSourceSnapshot,
  ensureEmptyDirectory,
  extractSourceArchive,
} from '../utils/code-source-archive';
import {
  createCodeApplication as createCodeApplicationHttp,
  listCodeApplications,
  resolveCodeApplicationPolicyOrigin,
} from './code-application-api';
import {
  getStoAppBindingByLocalPath,
  getStoAppBindingByWorkspaceId,
} from './sto-app-binding-store';
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
  applicationId?: string;
  applicationName?: string;
  revisionId?: string;
  devCommitSha?: string;
  raw?: unknown;
}

const CREATE_POLL_INTERVAL_MS = 2_000;
const CREATE_POLL_TIMEOUT_MS = 90_000;

async function registryUrl(): Promise<string> {
  return resolveCodeApplicationPolicyOrigin();
}

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

async function saiDetail(applicationId: string): Promise<CodeApplicationRecord> {
  logger.info(`[code-collab] sai detail applicationId=${applicationId}`);
  const result = await runSaiPolicy([
    'policy', 'code-application', 'detail',
    '--applicationId', applicationId,
  ]);
  if (!result.ok) throw new Error(saiCliErrorMessage(result));
  const detail = parseSaiCodeApplicationDetail(result.data);
  if (!detail?.applicationId) throw new Error('查询云端应用详情失败');
  return detail;
}

export async function createCodeApplication(input: {
  applicationName: string;
  description?: string | null;
}): Promise<CodeApplicationRecord> {
  return createCodeApplicationHttp(input);
}

export async function waitForActiveCodeApplication(
  applicationId: string,
): Promise<CodeApplicationRecord> {
  const startedAt = Date.now();
  let latest: CodeApplicationRecord | null = null;
  while (Date.now() - startedAt < CREATE_POLL_TIMEOUT_MS) {
    latest = await saiDetail(applicationId);
    const status = latest.status?.trim().toUpperCase() ?? '';
    if (status === 'ACTIVE') return latest;
    if (status === 'FAILED') {
      throw new Error('云端应用创建失败（status=FAILED），请稍后在应用广场删除后重试');
    }
    await new Promise((r) => { setTimeout(r, CREATE_POLL_INTERVAL_MS); });
  }
  throw new Error(`云端应用创建超时（当前状态：${latest?.status ?? '未知'}）`);
}

/**
 * Backfill `.sto/workspace.json` when device binding exists but the file was never written
 * (e.g. create raced before ACTIVE, or legacy apps before binding file rollout).
 */
export async function ensureStoWorkspaceBinding(
  appPath: string,
  hints?: { workspaceId?: string; applicationId?: string },
): Promise<StoWorkspaceFile | null> {
  const cwd = resolve(appPath);
  const existing = await readStoWorkspaceFile(cwd);
  if (existing) return existing;

  let applicationId = hints?.applicationId?.trim();
  if (!applicationId && hints?.workspaceId) {
    applicationId = (await getStoAppBindingByWorkspaceId(hints.workspaceId))?.applicationId;
  }
  if (!applicationId) {
    applicationId = (await getStoAppBindingByLocalPath(cwd))?.applicationId;
  }

  const listed = await listCodeApplications().catch(() => [] as CodeApplicationRecord[]);
  let cloud = applicationId
    ? listed.find((item) => item.applicationId === applicationId)
    : undefined;
  if (!applicationId) {
    const folderName = basename(cwd);
    cloud = listed.find((item) => item.applicationName === folderName);
    applicationId = cloud?.applicationId;
  }

  if (!applicationId) {
    logger.warn(`[code-collab] ensure workspace skip: no applicationId appPath=${cwd}`);
    return null;
  }

  let remote = cloud;
  try {
    remote = await saiDetail(applicationId);
  } catch (err) {
    logger.warn(`[code-collab] ensure workspace sai detail fallback appPath=${cwd}:`, err);
  }

  if (!remote || remote.status?.trim().toUpperCase() === 'FAILED') {
    logger.warn(
      `[code-collab] ensure workspace skip: status not writable appPath=${cwd} ` +
      `status=${remote?.status ?? '-'}`,
    );
    return null;
  }

  const written = await writeStoWorkspaceBinding({
    appPath: cwd,
    registryUrl: await registryUrl(),
    cloud: codeApplicationToWorkspaceFields(remote),
    fallback: { applicationId, status: 'ACTIVE' },
  });
  if (written) {
    logger.info(
      `[code-collab] ensured .sto/workspace.json appPath=${cwd} applicationId=${applicationId}`,
    );
  }
  return written;
}

async function requireWorkspace(
  appPath: string,
  hints?: { workspaceId?: string; applicationId?: string },
): Promise<{ cwd: string; state: StoWorkspaceFile }> {
  const cwd = await realpath(resolve(appPath));
  let state = await readStoWorkspaceFile(cwd);
  if (!state) {
    state = await ensureStoWorkspaceBinding(cwd, hints);
  }
  if (!state) {
    throw new Error('当前目录未绑定 STO 应用，缺少 .sto/workspace.json');
  }
  if (state.workspacePath !== cwd) {
    throw new Error('workspacePath 与当前目录不一致，请检查 .sto/workspace.json');
  }
  return { cwd, state };
}

async function assertRemoteBaseline(state: StoWorkspaceFile, remote: CodeApplicationRecord): Promise<void> {
  if (remote.status?.trim().toUpperCase() !== 'ACTIVE') {
    throw new Error(`应用不可操作，当前状态：${remote.status ?? '未知'}`);
  }
  const remoteRevision = remote.headRevisionId ?? null;
  const localRevision = state.baseRevisionId ?? null;
  if (remoteRevision && localRevision && remoteRevision !== localRevision) {
    throw new Error('REMOTE_AHEAD：请先下载远程最新代码并处理差异');
  }
  if (remoteRevision && !localRevision) {
    throw new Error('REMOTE_AHEAD：请先下载远程最新代码并处理差异');
  }
}

async function downloadArchiveBuffer(applicationId: string): Promise<Buffer> {
  logger.info(`[code-collab] sai download applicationId=${applicationId}`);
  const result = await runSaiPolicy([
    'policy', 'code-application', 'download',
    '--applicationId', applicationId,
  ]);
  if (!result.ok) throw new Error(saiCliErrorMessage(result));
  const saved = parseSaiDownloadSavedFiles(result.data);
  if (saved.length === 0) throw new Error('下载失败：CLI 未返回文件路径');
  const path = filePathFromSaiLocalUri(saved[0].localPath);
  const archive = await readFile(path);
  if (archive.length === 0) throw new Error('下载文件为空');
  gunzipSync(archive);
  return archive;
}

async function updateWorkspaceBaseline(
  appPath: string,
  remote: CodeApplicationRecord,
  revision: {
    revisionId: string;
    commitSha: string;
    sourceSha256: string;
  },
): Promise<void> {
  await writeStoWorkspaceBinding({
    appPath,
    registryUrl: await registryUrl(),
    cloud: {
      applicationId: remote.applicationId,
      applicationUid: remote.applicationUid,
      applicationCode: remote.applicationCode,
      status: 'ACTIVE',
      baseRevisionId: revision.revisionId,
      baseCommitSha: revision.commitSha,
      baseSourceSha256: revision.sourceSha256,
    },
    fallback: { applicationId: remote.applicationId, status: 'ACTIVE' },
  });
}

export async function getCodeCollabStatus(appPath: string): Promise<CodeCollabStatusSummary> {
  const cwd = resolve(appPath);
  logger.info(`[code-collab] action=status appPath=${cwd}`);
  try {
    const { state } = await requireWorkspace(cwd);
    const remote = await saiDetail(state.applicationId);
    let syncState: CodeCollabStatusSummary['syncState'] = 'unknown';
    const remoteRev = remote.headRevisionId ?? null;
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
      applicationId: state.applicationId,
      applicationName: remote.applicationName,
      revisionId: state.baseRevisionId ?? undefined,
      devCommitSha: state.baseCommitSha ?? undefined,
      raw: { local: state, remote },
    };
    logger.info(
      `[code-collab] action=status syncState=${summary.syncState} appId=${summary.applicationId}`,
    );
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
): Promise<CodeCollabCommandResult> {
  const trimmed = message.trim() || '更新应用';
  const { cwd, state } = await requireWorkspace(appPath);
  logger.info(`[code-collab] action=push appPath=${cwd} message=${JSON.stringify(trimmed)}`);

  const remote = await saiDetail(state.applicationId);
  await assertRemoteBaseline(state, remote);

  const revisionId = createUlid();
  const snapshot = await createSourceSnapshot(cwd);
  try {
    const createArgs = [
      'policy', 'code-revision', 'create',
      '--applicationId', state.applicationId,
      '--revisionId', revisionId,
      '--revisionMessage', trimmed,
      '--sourceSha256', snapshot.sourceSha256,
      '--archiveSha256', snapshot.archiveSha256,
      '--archiveSizeBytes', String(snapshot.archiveSizeBytes),
      '--expandedSizeBytes', String(snapshot.expandedSizeBytes),
      '--fileCount', String(snapshot.fileCount),
    ];
    if (state.baseRevisionId) {
      createArgs.push(
        '--baseRevisionId', state.baseRevisionId,
        '--parentRevisionId', state.baseRevisionId,
      );
    }
    const created = await runSaiPolicy(createArgs);
    if (!created.ok) throw new Error(saiCliErrorMessage(created));

    const uploaded = await runSaiPolicy([
      'policy', 'code-source', 'upload',
      '--applicationId', state.applicationId,
      '--versionId', revisionId,
      '--sourceFile', snapshot.archivePath,
    ]);
    if (!uploaded.ok) throw new Error(saiCliErrorMessage(uploaded));

    const verified = await runSaiPolicy([
      'policy', 'code-revision', 'detail',
      '--applicationId', state.applicationId,
      '--versionId', revisionId,
    ]);
    if (!verified.ok) throw new Error(saiCliErrorMessage(verified));
    const revision = parseSaiCodeRevision(verified.data);
    if (!revision || revision.status !== 'READY' || !revision.commitSha) {
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

    await updateWorkspaceBaseline(cwd, remote, {
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

  const remote = await saiDetail(state.applicationId);
  if (remote.status?.trim().toUpperCase() !== 'ACTIVE') {
    throw new Error(`应用不可拉取，当前状态：${remote.status ?? '未知'}`);
  }

  const archive = await downloadArchiveBuffer(state.applicationId);
  await applyArchiveToWorkspace(archive, cwd);

  const headRevisionId = remote.headRevisionId ?? null;
  let baseSourceSha256 = state.baseSourceSha256;
  if (headRevisionId) {
    const rev = await runSaiPolicy([
      'policy', 'code-revision', 'detail',
      '--applicationId', state.applicationId,
      '--versionId', headRevisionId,
    ]);
    if (rev.ok) {
      baseSourceSha256 = parseSaiCodeRevision(rev.data)?.sourceSha256 ?? baseSourceSha256;
    }
  }

  await writeStoWorkspaceBinding({
    appPath: cwd,
    registryUrl: await registryUrl(),
    cloud: {
      applicationId: remote.applicationId,
      applicationUid: remote.applicationUid,
      applicationCode: remote.applicationCode,
      status: 'ACTIVE',
      baseRevisionId: headRevisionId,
      baseCommitSha: remote.headCommitSha ?? null,
      baseSourceSha256: baseSourceSha256 ?? null,
    },
    fallback: { applicationId: remote.applicationId, status: 'ACTIVE' },
  });

  logger.info(`[code-collab] action=pull success applicationId=${state.applicationId}`);
  return { ok: true, output: '拉取成功', json: remote };
}

export async function cloneCodeApplication(
  applicationId: string,
  targetDir: string,
): Promise<CodeCollabCommandResult> {
  const id = applicationId.trim();
  const target = resolve(targetDir.trim());
  if (!id) throw new Error('缺少 applicationId');
  if (!target) throw new Error('缺少目标目录');

  logger.info(`[code-collab] action=clone applicationId=${id} targetDir=${target}`);
  await ensureEmptyDirectory(target);

  const remote = await saiDetail(id);
  if (remote.status?.trim().toUpperCase() !== 'ACTIVE') {
    throw new Error(`应用不可克隆，当前状态：${remote.status ?? '未知'}`);
  }

  const archive = await downloadArchiveBuffer(id);
  await extractSourceArchive(archive, target);

  await writeStoWorkspaceBinding({
    appPath: target,
    registryUrl: await registryUrl(),
    cloud: {
      applicationId: remote.applicationId,
      applicationUid: remote.applicationUid,
      applicationCode: remote.applicationCode,
      status: 'ACTIVE',
      baseRevisionId: remote.headRevisionId ?? null,
      baseCommitSha: remote.headCommitSha ?? null,
    },
    fallback: { applicationId: id, status: 'ACTIVE' },
  });

  logger.info(`[code-collab] action=clone success applicationId=${id} targetDir=${target}`);
  return {
    ok: true,
    output: '拉取成功',
    json: { applicationId: id, workspacePath: target, application: remote },
  };
}

export async function continueCodeApplicationMerge(
  _appPath: string,
  _revisionId: string,
): Promise<CodeCollabCommandResult> {
  throw new Error('当前版本暂不支持 merge continue，请先手动处理冲突后重新拉取并提交');
}
