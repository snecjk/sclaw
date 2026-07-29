import { constants, type Dirent } from 'node:fs';
import { access, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface LocalAuthorizedFileRecord {
  path: string;
  authorizedAt: string;
  excludedPaths?: string[];
}

export interface LocalAuthorizedFileEntry {
  entryId: string;
  entryType: 'file' | 'folder';
  parentEntryId: string;
  name: string;
  path: string;
  mimeType: string | null;
  fileExt: string | null;
  fileSize: number;
  createdAt: string | null;
  updatedAt: string | null;
  authorizedAt: string;
  missing?: boolean;
  permissionDenied?: boolean;
}

export interface LocalAuthorizedFilesResult {
  items: LocalAuthorizedFileEntry[];
  total: number;
  breadcrumbs: Array<{ entryId: string; name: string }>;
  stats: {
    authorizedCount: number;
    folderCount: number;
    uncategorizedFileCount: number;
  };
  permissionDenied?: {
    path: string;
    name: string;
  };
  authorizationSummary?: {
    acceptedCount: number;
    skipped: Array<{
      path: string;
      name: string;
    }>;
  };
}

interface LocalAuthorizedFilesStoreSchema {
  roots: LocalAuthorizedFileRecord[];
}

const STORE_NAME = 'local-authorized-files';
const ROOT_ENTRY_ID = 'root';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
};

type LocalAuthorizedFilesStore = {
  get: (key: 'roots') => LocalAuthorizedFileRecord[] | undefined;
  set: (key: 'roots', value: LocalAuthorizedFileRecord[]) => void;
};

let storeInstance: LocalAuthorizedFilesStore | null = null;

async function getStore() {
  if (!storeInstance) {
    const Store = (await import('electron-store')).default;
    storeInstance = new Store<LocalAuthorizedFilesStoreSchema>({
      name: STORE_NAME,
      defaults: { roots: [] },
    }) as LocalAuthorizedFilesStore;
  }
  return storeInstance;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function encodePathId(filePath: string): string {
  return `local:${Buffer.from(filePath, 'utf8').toString('base64url')}`;
}

function decodePathId(entryId: string): string {
  if (!entryId.startsWith('local:')) return '';
  return Buffer.from(entryId.slice('local:'.length), 'base64url').toString('utf8');
}

function getMimeType(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  return EXT_MIME_MAP[ext] || null;
}

function getPathDisplayName(filePath: string): string {
  const trimmedPath = filePath.trim();
  const windowsDriveMatch = trimmedPath.match(/^([a-zA-Z]):[\\/]*$/);
  if (windowsDriveMatch) return `${windowsDriveMatch[1].toUpperCase()}盘`;
  const baseName = basename(trimmedPath);
  if (baseName) return baseName;
  return trimmedPath || filePath;
}

function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'EACCES';
}

async function normalizeExistingPath(filePath: string): Promise<string> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  return await realpath(absolute);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeRelativePath(value: string): string {
  return value.trim().split(/[\\/]/).filter(Boolean).join('/');
}

function getRelativePath(rootPath: string, filePath: string): string {
  return normalizeRelativePath(relative(rootPath, filePath));
}

function normalizeExcludedPaths(paths: string[] | undefined): string[] {
  return [...new Set((paths ?? []).map(normalizeRelativePath).filter(Boolean))];
}

function isExcludedRelativePath(relativePath: string, excludedPaths: string[] | undefined): boolean {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return false;
  return normalizeExcludedPaths(excludedPaths).some((excludedPath) => (
    normalized === excludedPath || normalized.startsWith(`${excludedPath}/`)
  ));
}

function addExcludedPath(excludedPaths: string[] | undefined, relativePath: string): string[] {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return normalizeExcludedPaths(excludedPaths);
  const next = normalizeExcludedPaths(excludedPaths)
    .filter((excludedPath) => !(excludedPath === normalized || excludedPath.startsWith(`${normalized}/`)));
  if (next.some((excludedPath) => normalized.startsWith(`${excludedPath}/`))) return next;
  return [...next, normalized];
}

function updateExcludedPathsAfterRename(
  excludedPaths: string[] | undefined,
  oldRelativePath: string,
  newRelativePath: string,
): string[] {
  const oldPath = normalizeRelativePath(oldRelativePath);
  const newPath = normalizeRelativePath(newRelativePath);
  if (!oldPath || !newPath) return normalizeExcludedPaths(excludedPaths);
  return normalizeExcludedPaths(excludedPaths).map((excludedPath) => {
    if (excludedPath === oldPath) return newPath;
    if (excludedPath.startsWith(`${oldPath}/`)) return `${newPath}/${excludedPath.slice(oldPath.length + 1)}`;
    return excludedPath;
  });
}

async function readRoots(): Promise<LocalAuthorizedFileRecord[]> {
  const store = await getStore();
  const roots = store.get('roots');
  return Array.isArray(roots)
    ? roots.map((root) => ({ ...root, excludedPaths: normalizeExcludedPaths(root.excludedPaths) }))
    : [];
}

async function writeRoots(roots: LocalAuthorizedFileRecord[]): Promise<void> {
  const store = await getStore();
  store.set('roots', roots);
}

async function getAccessibleRoots(): Promise<LocalAuthorizedFileRecord[]> {
  const roots = await readRoots();
  const accessible: LocalAuthorizedFileRecord[] = [];
  for (const root of roots) {
    try {
      const normalized = await normalizeExistingPath(root.path);
      accessible.push({ ...root, path: normalized });
    } catch {
      accessible.push(root);
    }
  }
  return accessible;
}

async function resolveAuthorizedPath(filePath: string): Promise<{
  normalizedPath: string;
  root: LocalAuthorizedFileRecord;
  relativePath: string;
}> {
  const normalized = await normalizeExistingPath(filePath);
  const roots = await getAccessibleRoots();
  const sortedRoots = [...roots].sort((a, b) => b.path.length - a.path.length);
  for (const root of sortedRoots) {
    try {
      const rootPath = await normalizeExistingPath(root.path);
      if (!isPathInside(rootPath, normalized)) continue;
      const relativePath = getRelativePath(rootPath, normalized);
      if (isExcludedRelativePath(relativePath, root.excludedPaths)) continue;
      return {
        normalizedPath: normalized,
        root: { ...root, path: rootPath },
        relativePath,
      };
    } catch {
      // Missing roots are kept as records but cannot authorize child access.
    }
  }
  throw Object.assign(new Error('Path is not inside authorized local folders'), { statusCode: 403 });
}

async function assertAuthorizedPath(filePath: string): Promise<string> {
  return (await resolveAuthorizedPath(filePath)).normalizedPath;
}

async function buildEntry(
  filePath: string,
  parentEntryId: string,
  authorizedAt: string,
): Promise<LocalAuthorizedFileEntry> {
  const ext = extname(filePath).toLowerCase();
  try {
    const info = await stat(filePath);
    const entryType = info.isDirectory() ? 'folder' : 'file';
    let permissionDenied = false;
    try {
      await access(filePath, constants.R_OK);
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      permissionDenied = true;
    }
    return {
      entryId: encodePathId(filePath),
      entryType,
      parentEntryId,
      name: getPathDisplayName(filePath),
      path: filePath,
      mimeType: entryType === 'folder' ? null : getMimeType(filePath),
      fileExt: entryType === 'folder' ? null : ext.replace(/^\./, ''),
      fileSize: entryType === 'folder' ? 0 : info.size,
      createdAt: toIso(info.birthtime),
      updatedAt: toIso(info.mtime),
      authorizedAt,
      permissionDenied,
    };
  } catch (error) {
    const permissionDenied = isPermissionError(error);
    return {
      entryId: encodePathId(filePath),
      entryType: 'file',
      parentEntryId,
      name: getPathDisplayName(filePath),
      path: filePath,
      mimeType: getMimeType(filePath),
      fileExt: ext.replace(/^\./, '') || null,
      fileSize: 0,
      createdAt: null,
      updatedAt: null,
      authorizedAt,
      missing: !permissionDenied,
      permissionDenied,
    };
  }
}

async function assertSelectableAuthorizedRoot(filePath: string): Promise<string> {
  const normalized = await normalizeExistingPath(filePath);
  await access(normalized, constants.R_OK);
  const info = await stat(normalized);
  if (info.isDirectory()) {
    await readdir(normalized, { withFileTypes: true });
  }
  return normalized;
}

async function getStats(): Promise<LocalAuthorizedFilesResult['stats']> {
  const roots = await readRoots();
  let folderCount = 0;
  let uncategorizedFileCount = 0;
  for (const root of roots) {
    try {
      const info = await stat(root.path);
      if (info.isDirectory()) {
        folderCount += 1;
      } else {
        uncategorizedFileCount += 1;
      }
    } catch {
      uncategorizedFileCount += 1;
    }
  }
  return {
    authorizedCount: roots.length,
    folderCount,
    uncategorizedFileCount,
  };
}

function filterItems(items: LocalAuthorizedFileEntry[], keyword: string): LocalAuthorizedFileEntry[] {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => (
    item.name.toLowerCase().includes(normalized) ||
    item.path.toLowerCase().includes(normalized)
  ));
}

function sortItems(items: LocalAuthorizedFileEntry[]): LocalAuthorizedFileEntry[] {
  return [...items].sort((a, b) => {
    if (a.entryType !== b.entryType) return a.entryType === 'folder' ? -1 : 1;
    const timeA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const timeB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (timeA !== timeB) return timeB - timeA;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

async function buildBreadcrumbs(parentEntryId: string): Promise<Array<{ entryId: string; name: string }>> {
  if (parentEntryId === ROOT_ENTRY_ID) return [];
  const currentPath = await assertAuthorizedPath(decodePathId(parentEntryId));
  const roots = await getAccessibleRoots();
  const matchedRoot = roots.find((root) => isPathInside(root.path, currentPath));
  if (!matchedRoot) return [];
  const items = [{ entryId: ROOT_ENTRY_ID, name: '我的文件' }];
  const rootPath = matchedRoot.path;
  items.push({ entryId: encodePathId(rootPath), name: getPathDisplayName(rootPath) });
  const rel = relative(rootPath, currentPath);
  if (rel) {
    let cursor = rootPath;
    for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      items.push({ entryId: encodePathId(cursor), name: segment });
    }
  }
  return items;
}

export async function listLocalAuthorizedFiles(params: {
  parentEntryId?: string;
  keyword?: string;
}): Promise<LocalAuthorizedFilesResult> {
  const parentEntryId = params.parentEntryId || ROOT_ENTRY_ID;
  const stats = await getStats();
  let items: LocalAuthorizedFileEntry[];
  let permissionDenied: LocalAuthorizedFilesResult['permissionDenied'];
  if (parentEntryId === ROOT_ENTRY_ID) {
    const roots = await readRoots();
    items = await Promise.all(roots.map((root) => buildEntry(root.path, ROOT_ENTRY_ID, root.authorizedAt)));
  } else {
    const authorizedPath = await resolveAuthorizedPath(decodePathId(parentEntryId));
    const parentPath = authorizedPath.normalizedPath;
    const info = await stat(parentPath);
    if (!info.isDirectory()) {
      throw Object.assign(new Error('Entry is not a folder'), { statusCode: 400 });
    }
    let children: Dirent[];
    try {
      children = await readdir(parentPath, { withFileTypes: true });
    } catch (error) {
      if (!isPermissionError(error)) throw error;
      permissionDenied = { path: parentPath, name: getPathDisplayName(parentPath) };
      children = [];
    }
    const now = new Date().toISOString();
    items = await Promise.all(children
      .filter((child) => !child.name.startsWith('.'))
      .filter((child) => !isExcludedRelativePath(
        getRelativePath(authorizedPath.root.path, join(parentPath, child.name)),
        authorizedPath.root.excludedPaths,
      ))
      .map((child) => buildEntry(join(parentPath, child.name), parentEntryId, now)));
  }
  const filtered = sortItems(filterItems(items, params.keyword ?? ''));
  return {
    items: filtered,
    total: filtered.length,
    breadcrumbs: await buildBreadcrumbs(parentEntryId),
    stats,
    permissionDenied,
  };
}

export async function addLocalAuthorizedPaths(filePaths: string[]): Promise<LocalAuthorizedFilesResult> {
  const roots = await readRoots();
  const byPath = new Map(roots.map((root) => [root.path, root]));
  const now = new Date().toISOString();
  const skipped: NonNullable<LocalAuthorizedFilesResult['authorizationSummary']>['skipped'] = [];
  let acceptedCount = 0;
  for (const filePath of filePaths) {
    try {
      const normalized = await assertSelectableAuthorizedRoot(filePath);
      byPath.set(normalized, {
        path: normalized,
        authorizedAt: byPath.get(normalized)?.authorizedAt ?? now,
        excludedPaths: byPath.get(normalized)?.excludedPaths,
      });
      acceptedCount += 1;
    } catch {
      skipped.push({ path: filePath, name: getPathDisplayName(filePath) });
    }
  }
  await writeRoots([...byPath.values()]);
  return {
    ...await listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID }),
    authorizationSummary: { acceptedCount, skipped },
  };
}

export async function removeLocalAuthorizedEntry(entryId: string): Promise<LocalAuthorizedFilesResult> {
  const decodedPath = decodePathId(entryId);
  if (!decodedPath) {
    throw Object.assign(new Error('Invalid local authorized entry id'), { statusCode: 400 });
  }
  let targetPath = decodedPath;
  try {
    targetPath = await normalizeExistingPath(decodedPath);
  } catch {
    // Missing root records can still be removed from the authorization list.
  }
  const roots = await readRoots();
  const rootIndex = roots.findIndex((root) => root.path === targetPath || root.path === decodedPath);
  if (rootIndex >= 0) {
    await writeRoots(roots.filter((_, index) => index !== rootIndex));
    return listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID });
  }
  const authorizedPath = await resolveAuthorizedPath(targetPath);
  const targetRelativePath = getRelativePath(authorizedPath.root.path, targetPath);
  if (!targetRelativePath) {
    await writeRoots(roots.filter((root) => root.path !== authorizedPath.root.path));
    return listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID });
  }
  await writeRoots(roots.map((root) => root.path === authorizedPath.root.path
    ? { ...root, excludedPaths: addExcludedPath(root.excludedPaths, targetRelativePath) }
    : root));
  return listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID });
}

export async function renameLocalAuthorizedEntry(entryId: string, name: string): Promise<LocalAuthorizedFileEntry> {
  const authorizedPath = await resolveAuthorizedPath(decodePathId(entryId));
  const sourcePath = authorizedPath.normalizedPath;
  const cleanName = name.trim();
  if (!cleanName || cleanName.includes('/') || cleanName.includes('\\')) {
    throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
  }
  const targetPath = join(dirname(sourcePath), cleanName);
  await rename(sourcePath, targetPath);
  const roots = await readRoots();
  const nextRoots = roots.map((root) => {
    if (root.path === sourcePath) return { ...root, path: targetPath };
    if (root.path !== authorizedPath.root.path) return root;
    return {
      ...root,
      excludedPaths: updateExcludedPathsAfterRename(
        root.excludedPaths,
        authorizedPath.relativePath,
        getRelativePath(authorizedPath.root.path, targetPath),
      ),
    };
  });
  await writeRoots(nextRoots);
  return buildEntry(targetPath, encodePathId(dirname(targetPath)), new Date().toISOString());
}

export function getLocalAuthorizedPathFromEntryId(entryId: string): string {
  return decodePathId(entryId);
}
