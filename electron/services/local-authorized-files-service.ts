import { constants } from 'node:fs';
import { access, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface LocalAuthorizedFileRecord {
  path: string;
  authorizedAt: string;
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

async function normalizeExistingPath(filePath: string): Promise<string> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(filePath);
  return await realpath(absolute);
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function readRoots(): Promise<LocalAuthorizedFileRecord[]> {
  const store = await getStore();
  const roots = store.get('roots');
  return Array.isArray(roots) ? roots : [];
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

async function assertAuthorizedPath(filePath: string): Promise<string> {
  const normalized = await normalizeExistingPath(filePath);
  const roots = await getAccessibleRoots();
  for (const root of roots) {
    try {
      const rootPath = await normalizeExistingPath(root.path);
      if (isPathInside(rootPath, normalized)) return normalized;
    } catch {
      // Missing roots are kept as records but cannot authorize child access.
    }
  }
  throw Object.assign(new Error('Path is not inside authorized local folders'), { statusCode: 403 });
}

async function buildEntry(
  filePath: string,
  parentEntryId: string,
  authorizedAt: string,
): Promise<LocalAuthorizedFileEntry> {
  const ext = extname(filePath).toLowerCase();
  try {
    const info = await stat(filePath);
    return {
      entryId: encodePathId(filePath),
      entryType: info.isDirectory() ? 'folder' : 'file',
      parentEntryId,
      name: basename(filePath),
      path: filePath,
      mimeType: info.isDirectory() ? null : getMimeType(filePath),
      fileExt: info.isDirectory() ? null : ext.replace(/^\./, ''),
      fileSize: info.isDirectory() ? 0 : info.size,
      createdAt: toIso(info.birthtime),
      updatedAt: toIso(info.mtime),
      authorizedAt,
    };
  } catch {
    return {
      entryId: encodePathId(filePath),
      entryType: 'file',
      parentEntryId,
      name: basename(filePath),
      path: filePath,
      mimeType: getMimeType(filePath),
      fileExt: ext.replace(/^\./, '') || null,
      fileSize: 0,
      createdAt: null,
      updatedAt: null,
      authorizedAt,
      missing: true,
    };
  }
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
  items.push({ entryId: encodePathId(rootPath), name: basename(rootPath) });
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
  if (parentEntryId === ROOT_ENTRY_ID) {
    const roots = await readRoots();
    items = await Promise.all(roots.map((root) => buildEntry(root.path, ROOT_ENTRY_ID, root.authorizedAt)));
  } else {
    const parentPath = await assertAuthorizedPath(decodePathId(parentEntryId));
    const info = await stat(parentPath);
    if (!info.isDirectory()) {
      throw Object.assign(new Error('Entry is not a folder'), { statusCode: 400 });
    }
    const children = await readdir(parentPath, { withFileTypes: true });
    const now = new Date().toISOString();
    items = await Promise.all(children
      .filter((child) => !child.name.startsWith('.'))
      .map((child) => buildEntry(join(parentPath, child.name), parentEntryId, now)));
  }
  const filtered = sortItems(filterItems(items, params.keyword ?? ''));
  return {
    items: filtered,
    total: filtered.length,
    breadcrumbs: await buildBreadcrumbs(parentEntryId),
    stats,
  };
}

export async function addLocalAuthorizedPaths(filePaths: string[]): Promise<LocalAuthorizedFilesResult> {
  const roots = await readRoots();
  const byPath = new Map(roots.map((root) => [root.path, root]));
  const now = new Date().toISOString();
  for (const filePath of filePaths) {
    try {
      const normalized = await normalizeExistingPath(filePath);
      await access(normalized, constants.R_OK);
      byPath.set(normalized, {
        path: normalized,
        authorizedAt: byPath.get(normalized)?.authorizedAt ?? now,
      });
    } catch {
      // Skip inaccessible selections.
    }
  }
  await writeRoots([...byPath.values()]);
  return listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID });
}

export async function removeLocalAuthorizedEntry(entryId: string): Promise<LocalAuthorizedFilesResult> {
  const targetPath = decodePathId(entryId);
  const roots = await readRoots();
  await writeRoots(roots.filter((root) => root.path !== targetPath));
  return listLocalAuthorizedFiles({ parentEntryId: ROOT_ENTRY_ID });
}

export async function renameLocalAuthorizedEntry(entryId: string, name: string): Promise<LocalAuthorizedFileEntry> {
  const sourcePath = await assertAuthorizedPath(decodePathId(entryId));
  const cleanName = name.trim();
  if (!cleanName || cleanName.includes('/') || cleanName.includes('\\')) {
    throw Object.assign(new Error('Invalid file name'), { statusCode: 400 });
  }
  const targetPath = join(dirname(sourcePath), cleanName);
  await rename(sourcePath, targetPath);
  const roots = await readRoots();
  const nextRoots = roots.map((root) => root.path === sourcePath ? { ...root, path: targetPath } : root);
  await writeRoots(nextRoots);
  return buildEntry(targetPath, encodePathId(dirname(targetPath)), new Date().toISOString());
}

export function getLocalAuthorizedPathFromEntryId(entryId: string): string {
  return decodePathId(entryId);
}
