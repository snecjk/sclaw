import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, relative, sep } from 'node:path';

type PageType = 'site' | 'assets';
type ChangeKind = 'add' | 'modify' | 'delete';

export interface BuiltinTemplateDebugChange {
  path: string;
  kind: ChangeKind;
}

export interface BuiltinTemplateDebugStatus {
  isBuiltinDebug: boolean;
  templateId?: string;
  pageType?: PageType;
  sourceChanged: boolean;
  changes: BuiltinTemplateDebugChange[];
}

interface DebugMarker {
  kind: 'app-template';
  templateId: string;
  pageType: PageType;
  source?: 'local-resource' | 'memory-center';
  sourceFingerprint?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.sclaw',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '.next',
]);
const IGNORED_FILES = new Set([
  '.git',
  '.sclaw',
  '.sclaw-template-meta.json',
  '.ds_store',
  'package-lock.json',
]);
const SENSITIVE_FILES = new Set([
  '.npmrc',
  '.pypirc',
  '.netrc',
  'id_rsa',
  'id_ed25519',
  'credentials.json',
  'secrets.json',
]);
const SENSITIVE_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.log', '.local', '.tsbuildinfo'];
const activeWorkspaceMutations = new Set<string>();
const BUILTIN_TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

async function runWorkspaceMutation<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
  if (activeWorkspaceMutations.has(workspaceRoot)) {
    throw new Error('已有模板操作正在进行，请稍后重试');
  }
  activeWorkspaceMutations.add(workspaceRoot);
  try {
    return await operation();
  } finally {
    activeWorkspaceMutations.delete(workspaceRoot);
  }
}

export function resolveAppTemplateWorkspacePath(
  parentRoot: string,
  templateId: string,
  source?: 'local-resource' | 'memory-center',
): string {
  return source === 'local-resource'
    ? join(parentRoot, '.builtin-debug', templateId)
    : join(parentRoot, templateId);
}

export function assertBuiltinTemplateDebugModeAllowed(isPackaged: boolean): void {
  if (isPackaged) throw new Error('本地内置模板调试只在 SClaw 开发模式可用');
}

export function assertTemplateWorkspaceCanPublish(
  source?: 'local-resource' | 'memory-center',
): void {
  if (source === 'local-resource') {
    throw new Error('本地内置模板调试工作区不能发布');
  }
}

function relativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join(posix.sep);
}

function shouldIgnoreFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IGNORED_FILES.has(lower)
    || SENSITIVE_FILES.has(lower)
    || SENSITIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
    || (lower.startsWith('.env') && lower !== '.env.example');
}

async function collectTemplateFiles(
  root: string,
  current = root,
  files: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const entries = (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = join(current, entry.name);
    const path = relativePath(root, absolutePath);
    if (entry.isSymbolicLink()) throw new Error(`内置模板调试不支持符号链接: ${path}`);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
        await collectTemplateFiles(root, absolutePath, files);
      }
      continue;
    }
    if (!entry.isFile() || shouldIgnoreFile(entry.name)) continue;
    const bytes = await readFile(absolutePath);
    files.set(path, createHash('sha256').update(bytes).digest('hex'));
  }
  return files;
}

function fingerprintFiles(files: Map<string, string>): string {
  const hash = createHash('sha256');
  for (const [path, digest] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path).update('\0').update(digest).update('\0');
  }
  return hash.digest('hex');
}

export async function fingerprintBuiltinTemplateTree(root: string): Promise<string> {
  return fingerprintFiles(await collectTemplateFiles(root));
}

function compareFiles(
  workspaceFiles: Map<string, string>,
  sourceFiles: Map<string, string>,
): BuiltinTemplateDebugChange[] {
  const paths = [...new Set([...workspaceFiles.keys(), ...sourceFiles.keys()])].sort();
  return paths.flatMap((path): BuiltinTemplateDebugChange[] => {
    const workspaceHash = workspaceFiles.get(path);
    const sourceHash = sourceFiles.get(path);
    if (workspaceHash === sourceHash) return [];
    if (workspaceHash === undefined) return [{ path, kind: 'delete' }];
    if (sourceHash === undefined) return [{ path, kind: 'add' }];
    return [{ path, kind: 'modify' }];
  });
}

async function readDebugMarker(workspaceRoot: string): Promise<DebugMarker> {
  const markerPath = join(workspaceRoot, '.sclaw', 'app-template.json');
  const marker = JSON.parse(await readFile(markerPath, 'utf8')) as DebugMarker;
  if (
    marker.kind !== 'app-template'
    || marker.source !== 'local-resource'
    || !BUILTIN_TEMPLATE_ID_PATTERN.test(marker.templateId)
  ) {
    throw new Error('当前工作区不是本地内置模板调试工作区');
  }
  return marker;
}

function sourceRootFor(resourcesRoot: string, marker: DebugMarker): string {
  const sourceRoot = join(resourcesRoot, marker.templateId);
  if (!existsSync(join(sourceRoot, 'manifest.json')) || !existsSync(join(sourceRoot, 'package.json'))) {
    throw new Error(`内置模板资源缺失: ${marker.templateId}`);
  }
  return sourceRoot;
}

async function writeMarker(workspaceRoot: string, marker: DebugMarker): Promise<void> {
  marker.updatedAt = new Date().toISOString();
  await writeFile(
    join(workspaceRoot, '.sclaw', 'app-template.json'),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf8',
  );
}

async function assertWorkspaceTemplateIdentity(
  workspaceRoot: string,
  marker: DebugMarker,
): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(workspaceRoot, 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
  if (
    manifest.schemaVersion !== 1
    || manifest.templateId !== marker.templateId
    || manifest.pageType !== marker.pageType
  ) {
    throw new Error('manifest.json 与内置模板身份不一致');
  }
}

async function mirrorTemplateFiles(sourceRoot: string, targetRoot: string): Promise<void> {
  const sourceFiles = await collectTemplateFiles(sourceRoot);
  const targetFiles = existsSync(targetRoot)
    ? await collectTemplateFiles(targetRoot)
    : new Map<string, string>();
  await mkdir(targetRoot, { recursive: true });
  for (const targetPath of targetFiles.keys()) {
    if (!sourceFiles.has(targetPath)) {
      await rm(join(targetRoot, targetPath), { force: true });
    }
  }
  for (const sourcePath of sourceFiles.keys()) {
    const destination = join(targetRoot, sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(sourceRoot, sourcePath), destination);
  }
}

export async function initializeBuiltinTemplateDebugWorkspace(
  sourceRoot: string,
  workspaceRoot: string,
): Promise<void> {
  if (existsSync(workspaceRoot)) {
    throw new Error('内置模板调试工作区已存在');
  }
  await mkdir(dirname(workspaceRoot), { recursive: true });
  const transactionRoot = await mkdtemp(join(dirname(workspaceRoot), '.sclaw-template-init-'));
  const stagingRoot = join(transactionRoot, 'content');
  try {
    await mirrorTemplateFiles(sourceRoot, stagingRoot);
    await copySafeNpmrc(sourceRoot, stagingRoot);
    await rename(stagingRoot, workspaceRoot);
  } finally {
    await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function copySafeNpmrc(sourceRoot: string, targetRoot: string): Promise<void> {
  const npmrcPath = join(sourceRoot, '.npmrc');
  if (existsSync(npmrcPath)) {
    const npmrc = await readFile(npmrcPath, 'utf8');
    const safe = npmrc.split(/\r?\n/).every((line) => {
      const trimmed = line.trim();
      return !trimmed
        || trimmed.startsWith('#')
        || /^(?:@[a-z0-9._-]+:)?registry=https?:\/\/[^\s]+$/i.test(trimmed);
    });
    if (safe) await copyFile(npmrcPath, join(targetRoot, '.npmrc'));
  }
}

async function copyIgnoredEntries(
  sourceRoot: string,
  targetRoot: string,
  current = sourceRoot,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(current, entry.name);
    const path = relativePath(sourceRoot, sourcePath);
    const targetPath = join(targetRoot, path);
    if (entry.isSymbolicLink()) throw new Error(`内置模板调试不支持符号链接: ${path}`);
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath, { recursive: true });
      continue;
    }
    if (entry.isFile() && shouldIgnoreFile(entry.name)) {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      continue;
    }
    if (entry.isDirectory()) await copyIgnoredEntries(sourceRoot, targetRoot, sourcePath);
  }
}

async function replaceTemplateTreeAtomically(input: {
  sourceRoot: string;
  targetRoot: string;
  expectedTargetFingerprint: string;
}): Promise<void> {
  const targetParent = dirname(input.targetRoot);
  const transactionRoot = await mkdtemp(join(targetParent, '.sclaw-template-sync-'));
  const stagingRoot = join(transactionRoot, 'staging');
  const backupRoot = join(transactionRoot, 'backup');
  let targetMoved = false;
  let committed = false;
  try {
    await initializeBuiltinTemplateDebugWorkspace(input.targetRoot, stagingRoot);
    await copyIgnoredEntries(input.targetRoot, stagingRoot);
    await mirrorTemplateFiles(input.sourceRoot, stagingRoot);
    await rename(input.targetRoot, backupRoot);
    targetMoved = true;
    const movedFingerprint = await fingerprintBuiltinTemplateTree(backupRoot);
    if (movedFingerprint !== input.expectedTargetFingerprint) {
      throw new Error('内置模板源码已发生变化，请先重新加载后再同步');
    }
    await rename(stagingRoot, input.targetRoot);
    committed = true;
  } catch (error) {
    if (targetMoved && !committed && !existsSync(input.targetRoot)) {
      await rename(backupRoot, input.targetRoot);
    }
    throw error;
  } finally {
    await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mirrorTemplateFilesWithRollback(sourceRoot: string, targetRoot: string): Promise<void> {
  const transactionRoot = await mkdtemp(join(tmpdir(), `${basename(targetRoot)}-template-backup-`));
  const backupRoot = join(transactionRoot, 'backup');
  try {
    await initializeBuiltinTemplateDebugWorkspace(targetRoot, backupRoot);
    try {
      await mirrorTemplateFiles(sourceRoot, targetRoot);
    } catch (error) {
      await mirrorTemplateFiles(backupRoot, targetRoot);
      throw error;
    }
  } finally {
    await rm(transactionRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function inspectBuiltinTemplateDebugWorkspace(input: {
  workspaceRoot: string;
  resourcesRoot: string;
}): Promise<BuiltinTemplateDebugStatus> {
  let marker: DebugMarker;
  try {
    marker = await readDebugMarker(input.workspaceRoot);
  } catch {
    return { isBuiltinDebug: false, sourceChanged: false, changes: [] };
  }
  const sourceRoot = sourceRootFor(input.resourcesRoot, marker);
  const [workspaceFiles, sourceFiles] = await Promise.all([
    collectTemplateFiles(input.workspaceRoot),
    collectTemplateFiles(sourceRoot),
  ]);
  return {
    isBuiltinDebug: true,
    templateId: marker.templateId,
    pageType: marker.pageType,
    sourceChanged: !marker.sourceFingerprint
      || marker.sourceFingerprint !== fingerprintFiles(sourceFiles),
    changes: compareFiles(workspaceFiles, sourceFiles),
  };
}

export async function syncBuiltinTemplateDebugWorkspace(input: {
  workspaceRoot: string;
  resourcesRoot: string;
}): Promise<{ changedFiles: string[] }> {
  return runWorkspaceMutation(input.workspaceRoot, async () => {
    const marker = await readDebugMarker(input.workspaceRoot);
    const sourceRoot = sourceRootFor(input.resourcesRoot, marker);
    await assertWorkspaceTemplateIdentity(input.workspaceRoot, marker);
    const currentSourceFingerprint = await fingerprintBuiltinTemplateTree(sourceRoot);
    if (!marker.sourceFingerprint) {
      throw new Error('缺少内置模板源码基线，请先重新加载');
    }
    if (marker.sourceFingerprint !== currentSourceFingerprint) {
      throw new Error('内置模板源码已发生变化，请先重新加载后再同步');
    }
    const before = await inspectBuiltinTemplateDebugWorkspace(input);
    if (before.sourceChanged) {
      throw new Error('内置模板源码已发生变化，请先重新加载后再同步');
    }
    await replaceTemplateTreeAtomically({
      sourceRoot: input.workspaceRoot,
      targetRoot: sourceRoot,
      expectedTargetFingerprint: currentSourceFingerprint,
    });
    marker.sourceFingerprint = await fingerprintBuiltinTemplateTree(sourceRoot);
    await writeMarker(input.workspaceRoot, marker);
    return { changedFiles: before.changes.map((change) => change.path) };
  });
}

export async function resetBuiltinTemplateDebugWorkspace(input: {
  workspaceRoot: string;
  resourcesRoot: string;
}): Promise<{ changedFiles: string[] }> {
  return runWorkspaceMutation(input.workspaceRoot, async () => {
    const marker = await readDebugMarker(input.workspaceRoot);
    const sourceRoot = sourceRootFor(input.resourcesRoot, marker);
    const before = await inspectBuiltinTemplateDebugWorkspace(input);
    await mirrorTemplateFilesWithRollback(sourceRoot, input.workspaceRoot);
    marker.sourceFingerprint = await fingerprintBuiltinTemplateTree(sourceRoot);
    await writeMarker(input.workspaceRoot, marker);
    return { changedFiles: before.changes.map((change) => change.path) };
  });
}
