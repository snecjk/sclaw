/**
 * Source snapshot (tar.gz) and safe archive extraction for code-application upload/download.
 * Mirrors sto-app CLI snapshot/archive behavior without adding dependencies.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { gunzipSync } from 'node:zlib';
import { createGzip } from 'node:zlib';

const SOURCE_DIGEST_DOMAIN = 'sto-source-v1';
const DEFAULT_EXCLUDED_DIRECTORIES = new Set(['.git', '.sto', 'node_modules', '.data']);
const ALLOWED_ENV_FILES = new Set(['.env.example', '.env.sample', '.env.template']);

interface GitIgnoreRule {
  regex: RegExp;
  /** gitignore patterns without `/` match in any directory. */
  unanchored: boolean;
}

export interface SourceSnapshot {
  archivePath: string;
  tempDir: string;
  sourceSha256: string;
  archiveSha256: string;
  archiveSizeBytes: number;
  expandedSizeBytes: number;
  fileCount: number;
}

function normalizeRelativePath(workspace: string, path: string): string {
  return relative(workspace, path).split(sep).join('/');
}

function assertAllowed(path: string): void {
  if (!path || path.startsWith('/') || /[\u0000-\u001f\u007f]/.test(path)) {
    throw new Error(`源码路径不合法：${path}`);
  }
  const name = basename(path.toLowerCase());
  const keyFile = name === 'id_rsa'
    || name === 'id_ed25519'
    || name.endsWith('.pem')
    || name.endsWith('.key')
    || name.endsWith('.p12')
    || name.endsWith('.pfx');
  if (keyFile) {
    throw new Error(`禁止上传敏感文件：${path}`);
  }
}

function globPatternToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\//, '');
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function isSecretEnvFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (ALLOWED_ENV_FILES.has(lower)) return false;
  return lower === '.env' || lower.startsWith('.env.');
}

async function loadGitignorePatterns(workspace: string): Promise<GitIgnoreRule[]> {
  try {
    const text = await readFile(join(workspace, '.gitignore'), 'utf8');
    const patterns: GitIgnoreRule[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.startsWith('!')) continue;
      const withoutSlash = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
      const unanchored = !withoutSlash.includes('/');
      try {
        patterns.push({
          regex: globPatternToRegExp(withoutSlash),
          unanchored,
        });
      } catch {
        // ignore invalid globs
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

function isIgnored(relativePath: string, patterns: GitIgnoreRule[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return patterns.some((pattern) => {
    if (pattern.regex.test(normalized)) return true;
    if (!pattern.unanchored) return false;
    return segments.some((_, index) => pattern.regex.test(segments.slice(index).join('/')));
  });
}

async function walk(
  workspace: string,
  directory: string,
  output: string[],
  ignorePatterns: GitIgnoreRule[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    if (entry.isFile() && isSecretEnvFile(entry.name)) continue;
    const absolute = join(directory, entry.name);
    const info = await lstat(absolute);
    const normalized = normalizeRelativePath(workspace, absolute);
    if (info.isSymbolicLink()) {
      throw new Error(`源码目录不能包含符号链接：${normalized}`);
    }
    if (info.isFile()) assertAllowed(normalized);
    if (isIgnored(normalized, ignorePatterns)) continue;
    if (info.isDirectory()) {
      await walk(workspace, absolute, output, ignorePatterns);
    } else if (info.isFile()) {
      output.push(absolute);
    } else {
      throw new Error(`源码目录包含不支持的文件类型：${normalized}`);
    }
  }
}

/** Relative paths that would be packed into a source snapshot. */
export async function listSourceSnapshotFiles(workspace: string): Promise<string[]> {
  const ignorePatterns = await loadGitignorePatterns(workspace);
  const absoluteFiles: string[] = [];
  await walk(workspace, workspace, absoluteFiles, ignorePatterns);
  return absoluteFiles
    .map((filePath) => normalizeRelativePath(workspace, filePath))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, '0');
  if (octal.length > length - 1) throw new Error('tar 数字字段超出范围');
  header.write(octal, offset, length - 1, 'ascii');
  header[offset + length - 1] = 0;
}

function splitUstarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path, 'utf8') <= 100) return { name: path, prefix: '' };
  const segments = path.split('/');
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const prefix = segments.slice(0, index).join('/');
    const name = segments.slice(index).join('/');
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`源码路径超过 USTAR 限制：${path}`);
}

function createTarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  const parts = splitUstarPath(path);
  header.write(parts.name, 0, 100, 'utf8');
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  if (parts.prefix) header.write(parts.prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 32;
  return header;
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

function calculateSourceSha256(files: Array<{ path: string; size: number; sha256: string }>): string {
  const digest = createHash('sha256');
  digest.update(SOURCE_DIGEST_DOMAIN);
  digest.update(Buffer.from([0]));
  for (const file of files) {
    const path = Buffer.from(file.path, 'utf8');
    const pathLength = Buffer.allocUnsafe(4);
    pathLength.writeUInt32BE(path.length);
    const size = Buffer.allocUnsafe(8);
    size.writeBigUInt64BE(BigInt(file.size));
    digest.update(pathLength);
    digest.update(path);
    digest.update(size);
    digest.update(Buffer.from(file.sha256, 'hex'));
  }
  return digest.digest('hex');
}

async function fileSha256(path: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest('hex');
}

export async function createSourceSnapshot(workspace: string): Promise<SourceSnapshot> {
  const maxArchiveBytes = 100 * 1024 * 1024;
  const maxExpandedBytes = 500 * 1024 * 1024;
  const maxFileCount = 20_000;

  const ignorePatterns = await loadGitignorePatterns(workspace);
  const absoluteFiles: string[] = [];
  await walk(workspace, workspace, absoluteFiles, ignorePatterns);
  if (absoluteFiles.length > maxFileCount) {
    throw new Error(`源码文件数量超过限制 ${maxFileCount}`);
  }
  absoluteFiles.sort((left, right) => Buffer.compare(
    Buffer.from(normalizeRelativePath(workspace, left)),
    Buffer.from(normalizeRelativePath(workspace, right)),
  ));

  const temp = await mkdtemp(join(tmpdir(), 'sclaw-code-snapshot-'));
  const archivePath = join(temp, 'source.tar.gz');
  const output = createWriteStream(archivePath, { mode: 0o600 });
  const gzip = createGzip({ level: 9 });
  gzip.pipe(output);
  const completion = finished(output);

  const files: Array<{ path: string; size: number; sha256: string }> = [];
  let expandedSizeBytes = 0;

  try {
    for (const absolute of absoluteFiles) {
      const info = await stat(absolute);
      const path = normalizeRelativePath(workspace, absolute);
      await writeChunk(gzip, createTarHeader(path, info.size));
      const digest = createHash('sha256');
      let bytesRead = 0;
      for await (const chunk of createReadStream(absolute)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesRead += buffer.length;
        digest.update(buffer);
        await writeChunk(gzip, buffer);
      }
      if (bytesRead !== info.size) {
        throw new Error(`打包期间文件大小发生变化：${path}`);
      }
      const padding = (512 - (info.size % 512)) % 512;
      if (padding > 0) await writeChunk(gzip, Buffer.alloc(padding));
      files.push({ path, size: info.size, sha256: digest.digest('hex') });
      expandedSizeBytes += info.size;
      if (expandedSizeBytes > maxExpandedBytes) {
        throw new Error(`源码展开大小超过限制 ${maxExpandedBytes}`);
      }
    }
    await writeChunk(gzip, Buffer.alloc(1024));
    gzip.end();
    await completion;
    const archive = await stat(archivePath);
    if (archive.size > maxArchiveBytes) {
      throw new Error(`源码压缩包大小超过限制 ${maxArchiveBytes}`);
    }
    return {
      archivePath,
      tempDir: temp,
      sourceSha256: calculateSourceSha256(files),
      archiveSha256: await fileSha256(archivePath),
      archiveSizeBytes: archive.size,
      expandedSizeBytes,
      fileCount: files.length,
    };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await completion.catch(() => undefined);
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupSourceSnapshot(snapshot: Pick<SourceSnapshot, 'tempDir'>): Promise<void> {
  await rm(snapshot.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

function readString(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '').trim();
}

function parseSize(buffer: Buffer): number {
  const value = readString(buffer, 124, 12);
  if (!/^[0-7]*$/.test(value)) throw new Error('tar 条目大小不合法');
  return Number.parseInt(value || '0', 8);
}

function pathFromHeader(header: Buffer): string {
  const name = readString(header, 0, 100);
  const prefix = readString(header, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

function safeRelative(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized.includes('\0')
    || normalized.split('/').some((part) => part === '..' || !part)
  ) {
    throw new Error(`归档包含不安全路径：${value}`);
  }
  return normalized;
}

function parsePaxPath(data: Buffer): string | null {
  let offset = 0;
  let path: string | null = null;
  while (offset < data.length) {
    const separator = data.indexOf(0x20, offset);
    if (separator < 0) throw new Error('PAX 扩展头格式不合法');
    const lengthText = data.subarray(offset, separator).toString('ascii');
    const length = Number.parseInt(lengthText, 10);
    if (!Number.isSafeInteger(length) || length <= separator - offset + 1 || offset + length > data.length) {
      throw new Error('PAX 扩展头长度不合法');
    }
    const record = data.subarray(separator + 1, offset + length).toString('utf8').replace(/\n$/, '');
    const equals = record.indexOf('=');
    if (equals > 0 && record.slice(0, equals) === 'path') path = record.slice(equals + 1);
    offset += length;
  }
  return path;
}

function entryDestination(target: string, path: string): string {
  const destination = path ? join(target, ...path.split('/')) : target;
  const resolved = relative(target, destination);
  if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith('..')) {
    throw new Error('归档路径越界');
  }
  return destination;
}

/**
 * Cloud archives may wrap files in a single root folder. Local snapshots are flat.
 * Unwrap only when that folder itself looks like a project root (has package.json).
 */
async function unwrapSingleProjectRoot(stage: string): Promise<void> {
  const entries = await readdir(stage, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0]?.isDirectory()) return;
  const onlyDir = join(stage, entries[0].name);
  try {
    await readFile(join(onlyDir, 'package.json'));
  } catch {
    return;
  }
  for (const name of await readdir(onlyDir)) {
    await rename(join(onlyDir, name), join(stage, name));
  }
  await rm(onlyDir, { recursive: true, force: true });
}

export async function extractSourceArchive(archive: Buffer, target: string): Promise<void> {
  const tar = gunzipSync(archive);
  let offset = 0;
  let pendingPaxPath: string | null = null;
  let extracted = false;
  await mkdir(target, { recursive: true });

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = parseSize(header);
    const dataEnd = offset + 512 + size;
    if (dataEnd > tar.length) throw new Error('tar 条目内容不完整');
    const type = String.fromCharCode(header[156] || 48);
    const data = tar.subarray(offset + 512, dataEnd);

    if (type === 'x') {
      pendingPaxPath = parsePaxPath(data);
    } else if (type !== 'g') {
      if (type !== '0' && type !== '\0' && type !== '5') {
        throw new Error(`归档包含不支持的条目类型：${type}`);
      }
      const original = pendingPaxPath ?? pathFromHeader(header);
      pendingPaxPath = null;
      const normalized = safeRelative(original);
      const destination = entryDestination(target, normalized);
      if (type === '5') {
        await mkdir(destination, { recursive: true });
      } else {
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, data, { mode: 0o600 });
      }
      extracted = true;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (pendingPaxPath) throw new Error('PAX 扩展头缺少对应条目');
  if (!extracted) throw new Error('归档为空');
  await unwrapSingleProjectRoot(target);
}

export async function applyArchiveToWorkspace(archive: Buffer, workspace: string): Promise<void> {
  const stage = await mkdtemp(join(tmpdir(), 'sclaw-code-pull-'));
  try {
    await extractSourceArchive(archive, stage);
    for (const entry of await readdir(workspace)) {
      if (entry === '.sto') continue;
      await rm(join(workspace, entry), { recursive: true, force: true });
    }
    for (const entry of await readdir(stage)) {
      await cp(join(stage, entry), join(workspace, entry), { recursive: true, force: true });
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function ensureEmptyDirectory(path: string): Promise<void> {
  try {
    const entries = await readdir(path);
    if (entries.length > 0) throw new Error(`目标目录非空：${path}`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(path, { recursive: true });
      return;
    }
    throw error;
  }
}
