/**
 * Apply Site App source archives without wiping local-only files blindly,
 * and persist three-way merge state under `.sto/merge`.
 */

import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  STO_BASE_SNAPSHOT_RELATIVE,
  STO_MERGE_RELATIVE,
  classifyFileMerge,
  hasConflictMarkers,
  type SourceConflictFile,
  type SourceConflictKind,
} from '../../shared/site-app-source-merge';
import {
  extractSourceArchive,
  listSourceSnapshotFiles,
} from './code-source-archive';

export interface MergeStateFile {
  version: 1;
  oursBaseRevisionId: string;
  theirsRevisionId: string;
  theirsCommitSha: string;
  theirsSourceSha256: string;
  startedAt: number;
}

export interface MergeConflictsFile {
  files: SourceConflictFile[];
}

function mergeRoot(workspace: string): string {
  return join(workspace, ...STO_MERGE_RELATIVE.split('/'));
}

function baseSnapshotRoot(workspace: string): string {
  return join(workspace, ...STO_BASE_SNAPSHOT_RELATIVE.split('/'));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      await readdir(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function readOptionalBuffer(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function copyTreeContents(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source)) {
    await cp(join(source, entry), join(destination, entry), { recursive: true, force: true });
  }
}

async function clearDirectoryContents(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  for (const entry of await readdir(path)) {
    await rm(join(path, entry), { recursive: true, force: true });
  }
}

async function writeWorkspaceFile(workspace: string, relativePath: string, content: Buffer): Promise<void> {
  const destination = join(workspace, ...relativePath.split('/'));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, { mode: 0o600 });
}

async function deleteWorkspaceFile(workspace: string, relativePath: string): Promise<void> {
  await rm(join(workspace, ...relativePath.split('/')), { force: true });
}

async function fileSha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function collectPathSet(root: string): Promise<Set<string>> {
  const files = await listSourceSnapshotFiles(root);
  return new Set(files);
}

/** Clean remote-ahead apply: sync workspace to archive without first deleting everything. */
export async function applyArchiveFileDiff(
  archive: Buffer,
  workspace: string,
): Promise<void> {
  const stage = await mkdtemp(join(tmpdir(), 'sclaw-code-pull-diff-'));
  try {
    await extractSourceArchive(archive, stage);
    const remoteFiles = await collectPathSet(stage);
    const localFiles = await collectPathSet(workspace);

    for (const relative of remoteFiles) {
      const remotePath = join(stage, ...relative.split('/'));
      const localPath = join(workspace, ...relative.split('/'));
      const remoteHash = await fileSha256(remotePath);
      let localHash: string | null = null;
      try {
        localHash = await fileSha256(localPath);
      } catch {
        localHash = null;
      }
      if (localHash === remoteHash) continue;
      await mkdir(dirname(localPath), { recursive: true });
      await cp(remotePath, localPath, { force: true });
    }

    for (const relative of localFiles) {
      if (remoteFiles.has(relative)) continue;
      await deleteWorkspaceFile(workspace, relative);
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function cacheBaseSnapshotFromArchive(
  archive: Buffer,
  workspace: string,
): Promise<void> {
  const target = baseSnapshotRoot(workspace);
  const stage = await mkdtemp(join(tmpdir(), 'sclaw-base-snap-'));
  try {
    await extractSourceArchive(archive, stage);
    await clearDirectoryContents(target);
    await copyTreeContents(stage, target);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function cacheBaseSnapshotFromWorkspace(workspace: string): Promise<void> {
  const target = baseSnapshotRoot(workspace);
  await clearDirectoryContents(target);
  const files = await listSourceSnapshotFiles(workspace);
  for (const relative of files) {
    const source = join(workspace, ...relative.split('/'));
    const destination = join(target, ...relative.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
}

export async function readMergeState(workspace: string): Promise<MergeStateFile | null> {
  try {
    const raw = JSON.parse(await readFile(join(mergeRoot(workspace), 'state.json'), 'utf8')) as MergeStateFile;
    if (raw?.version !== 1 || !raw.theirsRevisionId) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function readMergeConflicts(workspace: string): Promise<SourceConflictFile[]> {
  try {
    const raw = JSON.parse(
      await readFile(join(mergeRoot(workspace), 'conflicts.json'), 'utf8'),
    ) as MergeConflictsFile;
    return Array.isArray(raw.files) ? raw.files : [];
  } catch {
    return [];
  }
}

async function writeMergeMeta(
  workspace: string,
  state: MergeStateFile,
  files: SourceConflictFile[],
): Promise<void> {
  const root = mergeRoot(workspace);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await writeFile(
    join(root, 'conflicts.json'),
    `${JSON.stringify({ files } satisfies MergeConflictsFile, null, 2)}\n`,
    'utf8',
  );
}

export async function clearMergeState(workspace: string): Promise<void> {
  await rm(mergeRoot(workspace), { recursive: true, force: true });
}

export async function workspaceHasConflictMarkers(workspace: string): Promise<boolean> {
  const files = await listSourceSnapshotFiles(workspace);
  for (const relative of files) {
    const buffer = await readFile(join(workspace, ...relative.split('/')));
    if (isBinaryPathish(relative, buffer)) continue;
    if (hasConflictMarkers(buffer.toString('utf8'))) return true;
  }
  return false;
}

function isBinaryPathish(path: string, buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'woff', 'woff2', 'ttf', 'zip', 'gz'].includes(ext);
}

/**
 * AI / 手动改掉冲突标记后，把 conflicts.json 里对应项标成 resolved。
 * 二进制仍需显式「用我的/用远端」。
 */
export async function reconcileMergeConflictsFromWorkspace(
  workspace: string,
): Promise<SourceConflictFile[]> {
  const state = await readMergeState(workspace);
  if (!state) return [];

  const files = await readMergeConflicts(workspace);
  let changed = false;
  const next: SourceConflictFile[] = [];

  for (const item of files) {
    if (item.status === 'resolved') {
      next.push(item);
      continue;
    }
    if (item.kind === 'binary') {
      next.push(item);
      continue;
    }

    const buffer = await readOptionalBuffer(join(workspace, ...item.path.split('/')));
    if (!buffer) {
      if (item.kind === 'add-delete') {
        next.push({ ...item, status: 'resolved' });
        changed = true;
        continue;
      }
      next.push(item);
      continue;
    }
    if (isBinaryPathish(item.path, buffer)) {
      next.push(item);
      continue;
    }
    if (!hasConflictMarkers(buffer.toString('utf8'))) {
      next.push({ ...item, status: 'resolved' });
      changed = true;
      continue;
    }
    next.push(item);
  }

  if (changed) await writeMergeMeta(workspace, state, next);
  return next.filter((item) => item.status !== 'resolved');
}

export async function listUnresolvedConflicts(workspace: string): Promise<SourceConflictFile[]> {
  const unresolved = await reconcileMergeConflictsFromWorkspace(workspace);
  if (unresolved.length > 0) return unresolved;
  if (await workspaceHasConflictMarkers(workspace)) {
    return [{ path: '(conflict-markers)', kind: 'text', status: 'unresolved' }];
  }
  return [];
}

export async function beginThreeWayMerge(input: {
  workspace: string;
  remoteArchive: Buffer;
  oursBaseRevisionId: string;
  theirsRevisionId: string;
  theirsCommitSha: string;
  theirsSourceSha256: string;
}): Promise<{ conflicts: SourceConflictFile[]; autoMerged: boolean }> {
  const existing = await readMergeState(input.workspace);
  if (existing && existing.theirsRevisionId === input.theirsRevisionId) {
    const conflicts = (await readMergeConflicts(input.workspace))
      .filter((item) => item.status !== 'resolved');
    return { conflicts, autoMerged: conflicts.length === 0 };
  }

  await clearMergeState(input.workspace);
  const root = mergeRoot(input.workspace);
  const oursDir = join(root, 'ours');
  const theirsDir = join(root, 'theirs');
  const baseDir = join(root, 'base');
  await mkdir(oursDir, { recursive: true });
  await mkdir(theirsDir, { recursive: true });
  await mkdir(baseDir, { recursive: true });

  const files = await listSourceSnapshotFiles(input.workspace);
  for (const relative of files) {
    const source = join(input.workspace, ...relative.split('/'));
    const destination = join(oursDir, ...relative.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }

  const theirsStage = await mkdtemp(join(tmpdir(), 'sclaw-merge-theirs-'));
  try {
    await extractSourceArchive(input.remoteArchive, theirsStage);
    await copyTreeContents(theirsStage, theirsDir);
  } finally {
    await rm(theirsStage, { recursive: true, force: true });
  }

  const cachedBase = baseSnapshotRoot(input.workspace);
  if (await pathExists(cachedBase)) {
    await copyTreeContents(cachedBase, baseDir);
  }

  const oursPaths = await collectPathSet(oursDir);
  const theirsPaths = await collectPathSet(theirsDir);
  const basePaths = await collectPathSet(baseDir);
  const allPaths = new Set([...oursPaths, ...theirsPaths, ...basePaths]);
  const conflicts: SourceConflictFile[] = [];

  for (const relative of [...allPaths].sort()) {
    const base = await readOptionalBuffer(join(baseDir, ...relative.split('/')));
    const ours = await readOptionalBuffer(join(oursDir, ...relative.split('/')));
    const theirs = await readOptionalBuffer(join(theirsDir, ...relative.split('/')));
    const decision = classifyFileMerge({ path: relative, base, ours, theirs });

    if (decision.action === 'keep-ours') continue;
    if (decision.action === 'delete') {
      await deleteWorkspaceFile(input.workspace, relative);
      continue;
    }
    if (decision.action === 'take-theirs' || decision.action === 'write') {
      if (!decision.content) continue;
      await writeWorkspaceFile(input.workspace, relative, decision.content);
      continue;
    }

    const kind: SourceConflictKind = decision.kind ?? 'text';
    if (decision.content) {
      await writeWorkspaceFile(input.workspace, relative, decision.content);
    } else if (ours) {
      await writeWorkspaceFile(input.workspace, relative, ours);
    }
    conflicts.push({ path: relative, kind, status: 'unresolved' });
  }

  const state: MergeStateFile = {
    version: 1,
    oursBaseRevisionId: input.oursBaseRevisionId,
    theirsRevisionId: input.theirsRevisionId,
    theirsCommitSha: input.theirsCommitSha,
    theirsSourceSha256: input.theirsSourceSha256,
    startedAt: Date.now(),
  };
  await writeMergeMeta(input.workspace, state, conflicts);
  return { conflicts, autoMerged: conflicts.length === 0 };
}

export async function resolveMergeConflictChoice(input: {
  workspace: string;
  path: string;
  choice: 'ours' | 'theirs';
}): Promise<SourceConflictFile[]> {
  const relative = input.path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (!relative || relative.includes('..')) throw new Error('冲突路径不合法');
  const state = await readMergeState(input.workspace);
  if (!state) throw new Error('当前没有待处理的合并');

  const sideRoot = join(mergeRoot(input.workspace), input.choice);
  const sidePath = join(sideRoot, ...relative.split('/'));
  const sideBuffer = await readOptionalBuffer(sidePath);
  if (!sideBuffer) {
    await deleteWorkspaceFile(input.workspace, relative);
  } else {
    await writeWorkspaceFile(input.workspace, relative, sideBuffer);
  }

  const files = await readMergeConflicts(input.workspace);
  const next = files
    .map((item) => (
      item.path === relative
        ? { ...item, status: 'resolved' as const }
        : item
    ));
  await writeMergeMeta(input.workspace, state, next);
  return next.filter((item) => item.status !== 'resolved');
}

export async function finalizeMergeContinue(workspace: string): Promise<MergeStateFile> {
  const state = await readMergeState(workspace);
  if (!state) throw new Error('当前没有待处理的合并');
  const unresolved = await reconcileMergeConflictsFromWorkspace(workspace);
  if (unresolved.length > 0) {
    throw new Error(`还有未解决的冲突：${unresolved.map((item) => item.path).join('、')}`);
  }
  if (await workspaceHasConflictMarkers(workspace)) {
    throw new Error('工作区仍有冲突标记，请先处理后再继续合并');
  }
  return state;
}
