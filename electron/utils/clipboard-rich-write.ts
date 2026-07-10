import { clipboard } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolveWorkspaceFilePath } from './artifact-path';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeNativeClipboardPath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return '';
  if (process.platform === 'win32') {
    return normalize(trimmed);
  }
  return trimmed;
}

function buildMacFilenamesPlist(filePaths: string[]): Buffer {
  const items = filePaths.map((path) => `  <string>${escapeXml(path)}</string>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
${items}
</array>
</plist>`;
  return Buffer.from(xml, 'utf8');
}

/** Windows CF_HDROP payload (DROPFILES + null-delimited UTF-16 path list). */
export function buildWindowsHDrop(filePaths: string[]): Buffer {
  const DROPFILES_SIZE = 20;
  const normalizedPaths = filePaths.map((path) => normalizeNativeClipboardPath(path)).filter(Boolean);
  const pathsUtf16 = normalizedPaths.map((path) => Buffer.from(`${path}\0`, 'utf16le'));
  const pathsBuffer = Buffer.concat([...pathsUtf16, Buffer.from('\0\0', 'utf16le')]);
  const buf = Buffer.alloc(DROPFILES_SIZE + pathsBuffer.length);
  buf.writeUInt32LE(DROPFILES_SIZE, 0);
  // Clipboard HDROP: pt=(-1,-1), fNC=TRUE, fWide=TRUE (MSDN DROPFILES)
  buf.writeInt32LE(-1, 4);
  buf.writeInt32LE(-1, 8);
  buf.writeInt32LE(1, 12);
  buf.writeInt32LE(1, 16);
  pathsBuffer.copy(buf, DROPFILES_SIZE);
  return buf;
}

function buildLinuxUriList(filePaths: string[]): Buffer {
  const lines = filePaths.map((path) => pathToFileURL(path).href);
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

function clearClipboardBestEffort(): void {
  try {
    clipboard.clear();
  } catch {
    // Another app may own the clipboard on Windows; continue and overwrite formats.
  }
}

function writeNativeFilePathsToClipboard(filePaths: string[]): void {
  const normalizedPaths = filePaths
    .map((path) => normalizeNativeClipboardPath(path))
    .filter(Boolean);
  if (normalizedPaths.length === 0) return;

  if (process.platform === 'darwin') {
    clipboard.writeBuffer('NSFilenamesPboardType', buildMacFilenamesPlist(normalizedPaths));
    return;
  }

  if (process.platform === 'win32') {
    clipboard.writeBuffer('CF_HDROP', buildWindowsHDrop(normalizedPaths));
    try {
      clipboard.writeBuffer('Preferred DropEffect', Buffer.from([0x01, 0x00, 0x00, 0x00]));
    } catch {
      // Optional format; HDROP alone is enough for Explorer paste.
    }
    return;
  }

  clipboard.writeBuffer('text/uri-list', buildLinuxUriList(normalizedPaths));
}

export function writeTextToSystemClipboard(text: string): void {
  const payload = text.trim() || ' ';
  clearClipboardBestEffort();
  // Electron writeText handles CF_UNICODETEXT null termination on Windows.
  clipboard.writeText(payload);
}

function normalizeClipboardFilePath(filePath: string): string {
  let path = filePath.trim();
  if (!path) return '';
  if (path.startsWith('preview://')) path = path.slice('preview://'.length);
  if (path.startsWith('artifact://')) path = path.slice('artifact://'.length);
  return path;
}

function isHttpUrl(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://');
}

function mimeTypeToExtension(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  const map: Record<string, string> = {
    'text/html': 'html',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
  };
  return map[normalized] || '';
}

function sanitizeClipboardFileName(
  fileName: string,
  fallbackPath: string,
  mimeType?: string,
): string {
  const fromName = basename(fileName.trim());
  const fromPath = basename(fallbackPath.trim());
  let resolved = fromName || fromPath || 'file';

  if (!resolved.includes('.')) {
    if (fromPath.includes('.')) {
      resolved = `${resolved}${fromPath.slice(fromPath.lastIndexOf('.'))}`;
    } else if (mimeType) {
      const ext = mimeTypeToExtension(mimeType);
      if (ext) resolved = `${resolved}.${ext}`;
    }
  }

  return resolved;
}

async function stageBytesForClipboard(buffer: Buffer, fileName: string, mimeType?: string): Promise<string> {
  const safeName = sanitizeClipboardFileName(fileName, fileName, mimeType);
  const dir = join(tmpdir(), 'stoclaw-clipboard', randomUUID());
  await mkdir(dir, { recursive: true });
  const stagedPath = join(dir, safeName);
  await writeFile(stagedPath, buffer);
  return stagedPath;
}

async function stageLocalFileForClipboard(
  sourcePath: string,
  fileName: string,
  mimeType?: string,
): Promise<string> {
  const safeName = sanitizeClipboardFileName(fileName, sourcePath, mimeType);
  if (basename(sourcePath) === safeName) {
    return sourcePath;
  }
  const dir = join(tmpdir(), 'stoclaw-clipboard', randomUUID());
  await mkdir(dir, { recursive: true });
  const stagedPath = join(dir, safeName);
  await copyFile(sourcePath, stagedPath);
  return stagedPath;
}

async function stageRemoteFile(
  url: string,
  fileName: string,
  mimeType?: string,
): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return stageBytesForClipboard(buffer, fileName, mimeType);
  } catch {
    return null;
  }
}

async function resolveCopyableFilePath(
  filePath: string,
  fileName: string,
  mimeType?: string,
): Promise<string | null> {
  const normalized = normalizeClipboardFilePath(filePath);
  if (!normalized) return null;

  if (isHttpUrl(normalized)) {
    return stageRemoteFile(normalized, fileName, mimeType);
  }

  let resolved = normalized;
  try {
    const candidate = resolveWorkspaceFilePath(normalized);
    if (existsSync(candidate)) resolved = candidate;
  } catch {
    // fall through
  }

  if (!existsSync(resolved)) return null;
  return stageLocalFileForClipboard(resolved, fileName, mimeType);
}

export async function writeFilesToSystemClipboard(
  files: Array<{ filePath: string; fileName: string; mimeType?: string }>,
): Promise<{ copiedFileCount: number }> {
  const resolvedPaths: string[] = [];

  for (const file of files) {
    const resolved = await resolveCopyableFilePath(file.filePath, file.fileName, file.mimeType);
    if (resolved) resolvedPaths.push(resolved);
  }

  if (resolvedPaths.length === 0) {
    throw new Error('No copyable files found');
  }

  clearClipboardBestEffort();
  writeNativeFilePathsToClipboard(resolvedPaths);
  return { copiedFileCount: resolvedPaths.length };
}
