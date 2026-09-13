import { app, shell } from 'electron';
import { lstat, mkdir, readdir, realpath, rm, statfs } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  resolveDiskStorageSeverity,
  resolveManagedStorageSeverity,
  resolveStorageCleanupCutoff,
  type StorageCleanupPolicy,
  type StorageCleanupMode,
  type StorageCleanupErrorCode,
  type StorageCleanupResult,
  type StorageOpenResult,
  type StorageOverview,
  type StorageTarget,
  type StorageUsage,
  type WorkspaceStorageTarget,
  type WorkflowRunStorageTarget,
} from '../../shared/storage-management';
import { DEFAULT_WORKSPACE_ID } from '../db/models/domain/session-catalog';
import { getChatRuntimeRepository } from '../db/repositories/chat-runtime-repository';
import { getWorkflowRuntimeRepository } from '../db/repositories/workflow-runtime-repository';
import { getWorkspaceRepository } from '../db/repositories/workspace-repository';
import { getSessionWorkspaceId } from './session-catalog-service';
import { workflowRuntimeWorkspacePath } from './workflow-runtime/workspace-paths';
import { getDefaultAgentWorkspacePath, getOpenClawConfigDir } from '../utils/paths';
import { getLogFilePath } from '../utils/logger';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WORKFLOW_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TERMINAL_WORKFLOW_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const ELECTRON_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache',
  'Shared Dictionary',
] as const;

interface TreeUsage {
  bytes: number;
  fileCount: number;
  latestModifiedMs: number | null;
  unavailable: boolean;
}

interface WorkspaceUsageScan {
  total: TreeUsage;
  cleanupBuckets: WorkspaceStorageTarget['cleanupBuckets'];
}

interface FileCandidate {
  path: string;
  bytes: number;
}

function emptyUsage(): TreeUsage {
  return { bytes: 0, fileCount: 0, latestModifiedMs: null, unavailable: false };
}

function mergeUsage(target: TreeUsage, source: TreeUsage): void {
  target.bytes += source.bytes;
  target.fileCount += source.fileCount;
  target.unavailable ||= source.unavailable;
  if (source.latestModifiedMs != null) {
    target.latestModifiedMs = Math.max(target.latestModifiedMs ?? 0, source.latestModifiedMs);
  }
}

async function scanTree(path: string): Promise<TreeUsage> {
  const usage = emptyUsage();
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return usage;
    return { ...usage, unavailable: true };
  }
  if (root.isSymbolicLink()) return { ...usage, unavailable: true };
  if (root.isFile()) {
    return { bytes: root.size, fileCount: 1, latestModifiedMs: root.mtimeMs, unavailable: false };
  }
  if (!root.isDirectory()) return usage;

  const stack = [path];
  let visited = 0;
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      usage.unavailable = true;
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const file = await lstat(fullPath);
          usage.bytes += file.size;
          usage.fileCount += 1;
          usage.latestModifiedMs = Math.max(usage.latestModifiedMs ?? 0, file.mtimeMs);
        } catch {
          usage.unavailable = true;
        }
      }
      visited += 1;
      if (visited % 200 === 0) await new Promise<void>((done) => setImmediate(done));
    }
  }
  return usage;
}

function addStorageUsage(target: StorageUsage, size: number): void {
  target.bytes += size;
  target.fileCount += 1;
}

async function scanWorkspaceTree(path: string, now = new Date()): Promise<WorkspaceUsageScan> {
  const total = emptyUsage();
  const cleanupBuckets: WorkspaceStorageTarget['cleanupBuckets'] = {
    olderThan7Days: { bytes: 0, fileCount: 0 },
    olderThan30Days: { bytes: 0, fileCount: 0 },
    olderThan90Days: { bytes: 0, fileCount: 0 },
    all: { bytes: 0, fileCount: 0 },
  };
  const cutoffs = {
    olderThan7Days: resolveStorageCleanupCutoff(now, 7),
    olderThan30Days: resolveStorageCleanupCutoff(now, 30),
    olderThan90Days: resolveStorageCleanupCutoff(now, 90),
  } as const;
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') total.unavailable = true;
    return { total, cleanupBuckets };
  }
  if (root.isSymbolicLink()) return { total: { ...total, unavailable: true }, cleanupBuckets };
  if (!root.isDirectory()) return { total, cleanupBuckets };

  const stack = [path];
  let visited = 0;
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      total.unavailable = true;
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const file = await lstat(fullPath);
          total.bytes += file.size;
          total.fileCount += 1;
          total.latestModifiedMs = Math.max(total.latestModifiedMs ?? 0, file.mtimeMs);
          addStorageUsage(cleanupBuckets.all, file.size);
          if (file.mtimeMs < cutoffs.olderThan7Days) addStorageUsage(cleanupBuckets.olderThan7Days, file.size);
          if (file.mtimeMs < cutoffs.olderThan30Days) addStorageUsage(cleanupBuckets.olderThan30Days, file.size);
          if (file.mtimeMs < cutoffs.olderThan90Days) addStorageUsage(cleanupBuckets.olderThan90Days, file.size);
        } catch {
          total.unavailable = true;
        }
      }
      visited += 1;
      if (visited % 200 === 0) await new Promise<void>((done) => setImmediate(done));
    }
  }
  return { total, cleanupBuckets };
}

async function collectFileCandidates(
  root: string,
  cutoffMs: number,
  containmentRoot: string,
): Promise<{ files: FileCandidate[]; unavailable: boolean }> {
  const files: FileCandidate[] = [];
  const stack = [root];
  let unavailable = false;
  let visited = 0;
  while (stack.length > 0) {
    const directory = stack.pop()!;
    if (!(await validateTrashTarget(containmentRoot, directory))) {
      unavailable = true;
      continue;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      unavailable = true;
      continue;
    }
    for (const entry of entries) {
      const fullPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        try {
          const info = await lstat(fullPath);
          if (info.mtimeMs < cutoffMs) files.push({ path: fullPath, bytes: info.size });
        } catch {
          unavailable = true;
        }
      }
      visited += 1;
      if (visited % 200 === 0) await new Promise<void>((done) => setImmediate(done));
    }
  }
  return { files, unavailable };
}

function cleanupResult(
  id: string,
  status: StorageCleanupResult['targets'][number]['status'],
  options: {
    bytes?: number;
    matched?: number;
    cleaned?: number;
    skipped?: number;
    failed?: number;
    errorCode?: StorageCleanupErrorCode;
  } = {},
): StorageCleanupResult['targets'][number] {
  return {
    id,
    status,
    bytes: options.bytes ?? 0,
    matchedFileCount: options.matched ?? 0,
    cleanedFileCount: options.cleaned ?? 0,
    skippedFileCount: options.skipped ?? 0,
    failedFileCount: options.failed ?? 0,
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
  };
}

function targetFromUsage(
  id: string,
  name: string,
  usage: TreeUsage,
  options?: { exists?: boolean; inUse?: boolean },
): StorageTarget {
  const status = options?.inUse
    ? 'in-use'
    : usage.unavailable
      ? 'unavailable'
      : options?.exists === false
        ? 'missing'
        : 'ready';
  return {
    id,
    name,
    bytes: usage.bytes,
    fileCount: usage.fileCount,
    latestModifiedAt: usage.latestModifiedMs == null ? null : new Date(usage.latestModifiedMs).toISOString(),
    status,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function diskSummary(): Promise<StorageOverview['disk']> {
  const stats = await statfs(app.getPath('userData'));
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  return { availableBytes, totalBytes, severity: resolveDiskStorageSeverity(availableBytes, totalBytes) };
}

function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + sep);
}

async function validateTrashTarget(root: string, candidate: string): Promise<boolean> {
  if (!isWithin(root, candidate)) return false;
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) return false;
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
    return isWithin(realRoot, realCandidate);
  } catch {
    return false;
  }
}

async function removeManagedPath(path: string, mode: StorageCleanupMode): Promise<void> {
  if (mode === 'trash') {
    await shell.trashItem(path);
    return;
  }
  await rm(path, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
}

function cleanupErrorCode(error: unknown, mode: StorageCleanupMode): StorageCleanupErrorCode {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') return 'ACCESS_DENIED';
  return mode === 'trash' ? 'TRASH_FAILED' : 'DELETE_FAILED';
}

export class StorageManagementService {
  private cached: { at: number; overview: StorageOverview } | null = null;
  private scanPromise: Promise<StorageOverview> | null = null;

  async hasActiveWork(): Promise<boolean> {
    const [chatRuns, workflowRuns] = await Promise.all([
      getChatRuntimeRepository().listActive().catch(() => []),
      getWorkflowRuntimeRepository()
        .listRunsByStatus(['PENDING', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_INPUT'])
        .catch(() => []),
    ]);
    return chatRuns.length > 0 || workflowRuns.length > 0;
  }

  async overview(options?: { force?: boolean; openClawInUse?: boolean }): Promise<StorageOverview> {
    if (!options?.force && this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) {
      return this.cached.overview;
    }
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.scan(options?.openClawInUse === true);
    try {
      const overview = await this.scanPromise;
      this.cached = { at: Date.now(), overview };
      return overview;
    } finally {
      this.scanPromise = null;
    }
  }

  invalidate(): void {
    this.cached = null;
  }

  private async activeWorkspaceIds(): Promise<Set<string>> {
    const active = await getChatRuntimeRepository().listActive().catch(() => []);
    const ids = new Set<string>();
    for (const run of active) {
      const workspaceId = await getSessionWorkspaceId(run.sessionKey).catch(() => DEFAULT_WORKSPACE_ID);
      ids.add(workspaceId);
    }
    return ids;
  }

  private async scan(openClawInUse: boolean): Promise<StorageOverview> {
    const [disk, workspaces, activeWorkspaceIds] = await Promise.all([
      diskSummary(),
      getWorkspaceRepository().list({ includeDefault: false }),
      this.activeWorkspaceIds(),
    ]);

    const workspaceTargets: WorkspaceStorageTarget[] = [];
    const defaultPath = join(getDefaultAgentWorkspacePath(), '.claw-output');
    const defaultUsage = await scanWorkspaceTree(defaultPath);
    workspaceTargets.push({
      ...targetFromUsage(
        `workspace-artifacts:${DEFAULT_WORKSPACE_ID}`,
        'Default workspace',
        defaultUsage.total,
        { exists: await pathExists(defaultPath), inUse: activeWorkspaceIds.has(DEFAULT_WORKSPACE_ID) },
      ),
      cleanupBuckets: defaultUsage.cleanupBuckets,
    });
    for (const workspace of workspaces) {
      const artifactPath = join(workspace.rootPath, '.sclaw', '.claw-output');
      const usage = await scanWorkspaceTree(artifactPath);
      workspaceTargets.push({
        ...targetFromUsage(
          `workspace-artifacts:${workspace.id}`,
          workspace.name,
          usage.total,
          { exists: await pathExists(artifactPath), inUse: activeWorkspaceIds.has(workspace.id) },
        ),
        cleanupBuckets: usage.cleanupBuckets,
      });
    }
    workspaceTargets.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

    const workflowRuns: WorkflowRunStorageTarget[] = [];
    const workflowRoot = workflowRuntimeWorkspacePath();
    let runEntries: Awaited<ReturnType<typeof readdir>> = [];
    try {
      runEntries = await readdir(workflowRoot, { withFileTypes: true });
    } catch { /* missing root */ }
    for (const entry of runEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !WORKFLOW_RUN_ID.test(entry.name)) continue;
      const runId = entry.name;
      const run = await getWorkflowRuntimeRepository().getRun(runId).catch(() => null);
      const status = run?.status == null ? null : String(run.status).toUpperCase();
      const orphaned = !run;
      const deletable = orphaned || TERMINAL_WORKFLOW_STATUSES.has(status ?? '');
      const usage = await scanTree(join(workflowRoot, runId));
      workflowRuns.push({
        ...targetFromUsage(`workflow-run:${runId}`, String(run?.chat_card_title || run?.workflow_id || runId), usage, {
          exists: true,
          inUse: !deletable,
        }),
        runId,
        workflowName: run ? String(run.chat_card_title || run.workflow_id || '') || null : null,
        runStatus: status,
        deletable,
        orphaned,
      });
    }
    workflowRuns.sort((a, b) => b.bytes - a.bytes || a.runId.localeCompare(b.runId));

    const openClawUsage = emptyUsage();
    for (const path of await this.openClawHistoryPaths()) mergeUsage(openClawUsage, await scanTree(path));
    const openClaw = targetFromUsage('openclaw-history', 'OpenClaw history', openClawUsage, {
      exists: openClawUsage.fileCount > 0,
      inUse: openClawInUse,
    });

    const appRuntimeUsage = emptyUsage();
    for (const path of await this.appRuntimeCleanupPaths()) mergeUsage(appRuntimeUsage, await scanTree(path));
    const appRuntime = targetFromUsage('app-runtime-cache', 'Application cache and logs', appRuntimeUsage, {
      exists: appRuntimeUsage.fileCount > 0,
    });

    const workflowBytes = workflowRuns.reduce((sum, item) => sum + item.bytes, 0);
    const workflowFiles = workflowRuns.reduce((sum, item) => sum + item.fileCount, 0);
    const managedBytes = appRuntime.bytes
      + openClaw.bytes
      + workflowBytes
      + workspaceTargets.reduce((sum, item) => sum + item.bytes, 0);
    return {
      scannedAt: new Date().toISOString(),
      disk,
      managedBytes,
      managedSeverity: resolveManagedStorageSeverity(managedBytes),
      appRuntime,
      openClaw,
      workspaces: workspaceTargets,
      workflowRuntime: { bytes: workflowBytes, fileCount: workflowFiles, runs: workflowRuns },
    };
  }

  private async openClawHistoryPaths(): Promise<string[]> {
    const root = getOpenClawConfigDir();
    const paths = [join(root, 'cron', 'runs'), join(root, 'runtime'), join(root, 'media', 'outbound')];
    try {
      const agents = await readdir(join(root, 'agents'), { withFileTypes: true });
      for (const agent of agents) {
        if (agent.isDirectory() && !agent.isSymbolicLink()) paths.push(join(root, 'agents', agent.name, 'sessions'));
      }
    } catch { /* missing agents */ }
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('.tmp-sto-skill-') && entry.name.endsWith('.zip')) {
          paths.push(join(root, entry.name));
        }
      }
    } catch { /* missing root */ }
    return paths;
  }

  /**
   * Only return disposable Electron/Chromium data. Account state, cookies,
   * databases, preferences, device identity and the active log are deliberately
   * excluded even though they live under the same userData directory.
   */
  private async appRuntimeCleanupPaths(): Promise<string[]> {
    const root = app.getPath('userData');
    const paths = ELECTRON_CACHE_DIRS.map((name) => join(root, name));

    try {
      const partitions = await readdir(join(root, 'Partitions'), { withFileTypes: true });
      for (const partition of partitions) {
        if (!partition.isDirectory() || partition.isSymbolicLink()) continue;
        for (const name of ELECTRON_CACHE_DIRS) paths.push(join(root, 'Partitions', partition.name, name));
      }
    } catch { /* missing partitions */ }

    const activeLog = getLogFilePath();
    const now = new Date();
    const activeLogName = `stoclaw-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.log`;
    try {
      const logs = await readdir(join(root, 'logs'), { withFileTypes: true });
      for (const log of logs) {
        if (!log.isFile() || log.isSymbolicLink()) continue;
        const logPath = join(root, 'logs', log.name);
        if (log.name !== activeLogName && (!activeLog || resolve(logPath) !== resolve(activeLog))) paths.push(logPath);
      }
    } catch { /* missing logs */ }

    return paths;
  }

  async cleanup(
    targetIds: string[],
    options: { mode: StorageCleanupMode; openClawInUse?: boolean; policy?: StorageCleanupPolicy },
  ): Promise<StorageCleanupResult> {
    const before = await diskSummary().catch(() => null);
    const targets: StorageCleanupResult['targets'] = [];
    const uniqueIds = [...new Set(targetIds)];
    for (const id of uniqueIds) {
      targets.push(await this.cleanupTarget(id, options.openClawInUse === true, options.mode, options.policy));
    }
    this.invalidate();
    const after = await diskSummary().catch(() => null);
    const cleanedBytes = targets.reduce((sum, item) => sum + item.bytes, 0);
    return {
      mode: options.mode,
      cleanedBytes,
      movedToTrashBytes: options.mode === 'trash' ? cleanedBytes : 0,
      permanentlyDeletedBytes: options.mode === 'delete' ? cleanedBytes : 0,
      diskFreeBytesBefore: before?.availableBytes ?? null,
      diskFreeBytesAfter: after?.availableBytes ?? null,
      targets,
    };
  }

  async openWorkspaceArtifactsFolder(targetId: string): Promise<StorageOpenResult> {
    if (!targetId.startsWith('workspace-artifacts:')) {
      return { opened: false, errorCode: 'TARGET_NOT_FOUND' };
    }
    const workspaceId = targetId.slice('workspace-artifacts:'.length);
    const workspaceRoot = workspaceId === DEFAULT_WORKSPACE_ID
      ? getDefaultAgentWorkspacePath()
      : (await getWorkspaceRepository().getById(workspaceId))?.rootPath;
    if (!workspaceRoot) return { opened: false, errorCode: 'TARGET_NOT_FOUND' };

    try {
      const rootInfo = await lstat(workspaceRoot);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        return { opened: false, errorCode: 'PATH_INVALID' };
      }
    } catch {
      return { opened: false, errorCode: 'TARGET_NOT_FOUND' };
    }

    const artifactPath = workspaceId === DEFAULT_WORKSPACE_ID
      ? join(workspaceRoot, '.claw-output')
      : join(workspaceRoot, '.sclaw', '.claw-output');
    const artifactParent = resolve(artifactPath, '..');
    try {
      if (!(await pathExists(artifactParent))) await mkdir(artifactParent);
    } catch {
      return { opened: false, errorCode: 'CREATE_FAILED' };
    }
    if (!(await validateTrashTarget(workspaceRoot, artifactParent))) {
      return { opened: false, errorCode: 'PATH_INVALID' };
    }
    try {
      if (!(await pathExists(artifactPath))) await mkdir(artifactPath);
    } catch {
      return { opened: false, errorCode: 'CREATE_FAILED' };
    }
    if (!(await validateTrashTarget(workspaceRoot, artifactPath))) {
      return { opened: false, errorCode: 'PATH_INVALID' };
    }
    const error = await shell.openPath(artifactPath);
    return error ? { opened: false, errorCode: 'OPEN_FAILED' } : { opened: true };
  }

  private async cleanupTarget(
    id: string,
    openClawInUse: boolean,
    mode: StorageCleanupMode,
    policy?: StorageCleanupPolicy,
  ): Promise<StorageCleanupResult['targets'][number]> {
    if (id === 'app-runtime-cache') {
      let bytes = 0;
      let matched = 0;
      let cleaned = 0;
      let failedCount = 0;
      let failed: StorageCleanupErrorCode | undefined;
      const root = app.getPath('userData');
      for (const path of await this.appRuntimeCleanupPaths()) {
        const usage = await scanTree(path);
        if (usage.fileCount === 0 || !(await pathExists(path))) continue;
        matched += usage.fileCount;
        if (!(await validateTrashTarget(root, path)) || resolve(path) === resolve(root)) {
          failed = 'PATH_INVALID';
          failedCount += usage.fileCount;
          continue;
        }
        try {
          await removeManagedPath(path, mode);
          bytes += usage.bytes;
          cleaned += usage.fileCount;
        } catch (error) {
          failed = cleanupErrorCode(error, mode);
          failedCount += usage.fileCount;
        }
      }
      return cleanupResult(id, failed ? (cleaned > 0 ? 'partial' : 'failed') : matched > 0 ? 'cleaned' : 'skipped', {
        bytes, matched, cleaned, failed: failedCount, errorCode: failed,
      });
    }

    if (id === 'openclaw-history') {
      if (openClawInUse) return cleanupResult(id, 'skipped', { errorCode: 'TARGET_IN_USE' });
      let bytes = 0;
      let matched = 0;
      let cleaned = 0;
      let failedCount = 0;
      let failed: StorageCleanupErrorCode | undefined;
      const root = getOpenClawConfigDir();
      for (const path of await this.openClawHistoryPaths()) {
        const usage = await scanTree(path);
        if (usage.fileCount === 0 || !(await pathExists(path))) continue;
        matched += usage.fileCount;
        if (!(await validateTrashTarget(root, path))) {
          failed = 'PATH_INVALID';
          failedCount += usage.fileCount;
          continue;
        }
        try {
          await removeManagedPath(path, mode);
          bytes += usage.bytes;
          cleaned += usage.fileCount;
        } catch (error) {
          failed = cleanupErrorCode(error, mode);
          failedCount += usage.fileCount;
        }
      }
      return cleanupResult(id, failed ? (cleaned > 0 ? 'partial' : 'failed') : matched > 0 ? 'cleaned' : 'skipped', {
        bytes, matched, cleaned, failed: failedCount, errorCode: failed,
      });
    }

    if (id.startsWith('workflow-run:')) {
      const runId = id.slice('workflow-run:'.length);
      if (!WORKFLOW_RUN_ID.test(runId)) return cleanupResult(id, 'failed', { errorCode: 'PATH_INVALID' });
      const run = await getWorkflowRuntimeRepository().getRun(runId).catch(() => null);
      const status = run?.status == null ? null : String(run.status).toUpperCase();
      if (run && !TERMINAL_WORKFLOW_STATUSES.has(status ?? '')) {
        return cleanupResult(id, 'skipped', { errorCode: 'TARGET_IN_USE' });
      }
      return this.cleanupSingleDirectory(id, workflowRuntimeWorkspacePath(), join(workflowRuntimeWorkspacePath(), runId), mode);
    }

    if (id.startsWith('workspace-artifacts:')) {
      const workspaceId = id.slice('workspace-artifacts:'.length);
      const activeIds = await this.activeWorkspaceIds();
      if (activeIds.has(workspaceId)) return cleanupResult(id, 'skipped', { errorCode: 'TARGET_IN_USE' });
      const workspaceRoot = workspaceId === DEFAULT_WORKSPACE_ID
        ? getDefaultAgentWorkspacePath()
        : (await getWorkspaceRepository().getById(workspaceId))?.rootPath;
      if (!workspaceRoot) return cleanupResult(id, 'failed', { errorCode: 'PATH_INVALID' });
      const artifactPath = workspaceId === DEFAULT_WORKSPACE_ID
        ? join(workspaceRoot, '.claw-output')
        : join(workspaceRoot, '.sclaw', '.claw-output');
      const workspacePolicy = policy ?? { kind: 'older-than', days: 7 };
      if (workspacePolicy.kind === 'all') {
        const result = await this.cleanupSingleDirectory(id, workspaceRoot, artifactPath, mode);
        if (result.status === 'cleaned') await mkdir(artifactPath, { recursive: true });
        return result;
      }
      return this.cleanupWorkspaceFilesOlderThan(
        id,
        workspaceRoot,
        artifactPath,
        resolveStorageCleanupCutoff(new Date(), workspacePolicy.days),
        mode,
      );
    }

    return cleanupResult(id, 'failed', { errorCode: 'PATH_INVALID' });
  }

  private async cleanupWorkspaceFilesOlderThan(
    id: string,
    workspaceRoot: string,
    artifactPath: string,
    cutoffMs: number,
    mode: StorageCleanupMode,
  ): Promise<StorageCleanupResult['targets'][number]> {
    if (!(await pathExists(artifactPath))) return cleanupResult(id, 'skipped');
    if (!(await validateTrashTarget(workspaceRoot, artifactPath))) {
      return cleanupResult(id, 'failed', { errorCode: 'PATH_INVALID' });
    }
    const candidates = await collectFileCandidates(artifactPath, cutoffMs, workspaceRoot);
    let bytes = 0;
    let cleaned = 0;
    let skipped = 0;
    let failed = 0;
    let errorCode: StorageCleanupErrorCode | undefined = candidates.unavailable ? 'ACCESS_DENIED' : undefined;
    for (const candidate of candidates.files) {
      try {
        const current = await lstat(candidate.path);
        if (!current.isFile() || current.isSymbolicLink() || current.mtimeMs >= cutoffMs) {
          skipped += 1;
          continue;
        }
        if (!(await validateTrashTarget(workspaceRoot, candidate.path))) {
          failed += 1;
          errorCode = 'PATH_INVALID';
          continue;
        }
        await removeManagedPath(candidate.path, mode);
        bytes += current.size;
        cleaned += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          skipped += 1;
        } else {
          failed += 1;
          errorCode = cleanupErrorCode(error, mode);
        }
      }
      if ((cleaned + skipped + failed) % 100 === 0) await new Promise<void>((done) => setImmediate(done));
    }
    const incomplete = skipped > 0 || failed > 0 || candidates.unavailable;
    const status = candidates.files.length === 0
      ? (candidates.unavailable ? 'failed' : 'skipped')
      : incomplete
        ? (cleaned > 0 ? 'partial' : failed > 0 || candidates.unavailable ? 'failed' : 'skipped')
        : 'cleaned';
    return cleanupResult(id, status, {
      bytes,
      matched: candidates.files.length,
      cleaned,
      skipped,
      failed,
      errorCode,
    });
  }

  private async cleanupSingleDirectory(
    id: string,
    root: string,
    path: string,
    mode: StorageCleanupMode,
  ): Promise<StorageCleanupResult['targets'][number]> {
    if (!(await pathExists(path))) return cleanupResult(id, 'skipped');
    if (!(await validateTrashTarget(root, path))) return cleanupResult(id, 'failed', { errorCode: 'PATH_INVALID' });
    const usage = await scanTree(path);
    try {
      await removeManagedPath(path, mode);
      return cleanupResult(id, 'cleaned', {
        bytes: usage.bytes,
        matched: usage.fileCount,
        cleaned: usage.fileCount,
      });
    } catch (error) {
      return cleanupResult(id, 'failed', {
        matched: usage.fileCount,
        failed: usage.fileCount,
        errorCode: cleanupErrorCode(error, mode),
      });
    }
  }
}

export const storageManagementService = new StorageManagementService();
