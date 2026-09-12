import type { IncomingMessage, ServerResponse } from 'http';
import { dialog, nativeImage } from 'electron';
import crypto from 'node:crypto';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { copyFile, mkdtemp, readFile, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getOpenClawConfigDir } from '../../utils/paths';
import { resolveWorkspaceFilePath } from '../../utils/artifact-path';
import { existsSync } from 'node:fs';
import { uploadOssFile } from '../../utils/oss-temp-upload';
import { writeTextToSystemClipboard, writeFilesToSystemClipboard } from '../../utils/clipboard-rich-write';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
};

function getMimeType(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] || 'application/octet-stream';
}

function mimeToExt(mimeType: string): string {
  for (const [ext, mime] of Object.entries(EXT_MIME_MAP)) {
    if (mime === mimeType) return ext;
  }
  return '';
}

const OUTBOUND_DIR = join(getOpenClawConfigDir(), 'media', 'outbound');
const MAX_TEMP_OSS_FILE_BYTES = 200 * 1024 * 1024;

function resolveTempOssUploadPath(filePath: string, cwd?: string): string {
  const normalizedCwd = cwd?.trim();
  if (/^file:\/\//iu.test(filePath)) return fileURLToPath(filePath);
  if (/^~(?:[\\/]|$)/u.test(filePath)) {
    return resolve(homedir(), filePath.slice(1).replace(/^[\\/]+/u, ''));
  }
  if (isAbsolute(filePath) || /^[A-Za-z]:[\\/]/u.test(filePath)) return filePath;
  if (normalizedCwd) return resolve(resolveTempOssUploadPath(normalizedCwd), filePath);
  return resolveWorkspaceFilePath(filePath);
}

async function validateTempOssUploadFile(filePath: string): Promise<void> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw Object.assign(new Error(`File not found: ${filePath}`), {
      statusCode: 404,
      errCode: 'OSS_FILE_NOT_FOUND',
    });
  }
  if (!fileStat.isFile()) {
    throw Object.assign(new Error('Selected path is not a regular file'), {
      statusCode: 400,
      errCode: 'OSS_FILE_NOT_REGULAR',
    });
  }
  if (fileStat.size <= 0) {
    throw Object.assign(new Error('File is empty'), {
      statusCode: 400,
      errCode: 'OSS_FILE_EMPTY',
    });
  }
  if (fileStat.size > MAX_TEMP_OSS_FILE_BYTES) {
    throw Object.assign(new Error('File cannot exceed 200 MiB'), {
      statusCode: 413,
      errCode: 'OSS_FILE_TOO_LARGE',
    });
  }
}

function fileRouteErrorStatus(error: unknown): number {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}

/**
 * Read file with EPERM/EACCES fallback: copy to temp directory and read from there.
 * macOS sometimes locks files created by other processes (e.g. AI tools).
 */
async function readFileWithFallback(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (err: unknown) {
    const code = err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
    if (code === 'EPERM' || code === 'EACCES') {
      const tmpDir = await mkdtemp(join(tmpdir(), 'stoclaw-'));
      const tmpFile = join(tmpDir, 'tmpfile');
      try {
        await copyFile(filePath, tmpFile);
        const buf = await readFile(tmpFile);
        await unlink(tmpFile).catch(() => {});
        return buf;
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

async function generateImagePreview(filePath: string, mimeType: string): Promise<string | null> {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    const maxDim = 512;
    if (size.width > maxDim || size.height > maxDim) {
      const resized = size.width >= size.height
        ? img.resize({ width: maxDim })
        : img.resize({ height: maxDim });
      return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
    }
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    return `data:${mimeType};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function handleFileRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/files/stage-paths' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePaths: string[] }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const results = [];
      for (const filePath of body.filePaths) {
        const id = crypto.randomUUID();
        const ext = extname(filePath);
        const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
        await fsP.copyFile(filePath, stagedPath);
        const s = await fsP.stat(stagedPath);
        const mimeType = getMimeType(ext);
        const fileName = filePath.split(/[\\/]/).pop() || 'file';
        const preview = mimeType.startsWith('image/')
          ? await generateImagePreview(stagedPath, mimeType)
          : null;
        results.push({ id, fileName, mimeType, fileSize: s.size, stagedPath, preview });
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/stage-buffer' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ base64: string; fileName: string; mimeType: string }>(req);
      const fsP = await import('node:fs/promises');
      await fsP.mkdir(OUTBOUND_DIR, { recursive: true });
      const id = crypto.randomUUID();
      const ext = extname(body.fileName) || mimeToExt(body.mimeType);
      const stagedPath = join(OUTBOUND_DIR, `${id}${ext}`);
      const buffer = Buffer.from(body.base64, 'base64');
      await fsP.writeFile(stagedPath, buffer);
      const mimeType = body.mimeType || getMimeType(ext);
      const preview = mimeType.startsWith('image/')
        ? await generateImagePreview(stagedPath, mimeType)
        : null;
      sendJson(res, 200, {
        id,
        fileName: body.fileName,
        mimeType,
        fileSize: buffer.length,
        stagedPath,
        preview,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/thumbnails' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ paths: Array<{ filePath: string; mimeType: string }> }>(req);
      const fsP = await import('node:fs/promises');
      const results: Record<string, { preview: string | null; fileSize: number }> = {};
      for (const { filePath, mimeType } of body.paths) {
        try {
          const s = await fsP.stat(filePath);
          const preview = mimeType.startsWith('image/')
            ? await generateImagePreview(filePath, mimeType)
            : null;
          results[filePath] = { preview, fileSize: s.size };
        } catch {
          results[filePath] = { preview: null, fileSize: 0 };
        }
      }
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/files/list-recursive — recursively list files inside a local folder
  // (used by data-center folder upload; Windows cannot pick files and folders in one dialog)
  if (url.pathname === '/api/files/list-recursive' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ dirPath: string }>(req);
      const rawPath = body.dirPath?.trim() || '';
      if (!rawPath) {
        sendJson(res, 400, { success: false, error: 'Missing dirPath' });
        return true;
      }
      const rootPath = resolveWorkspaceFilePath(rawPath);
      const fsP = await import('node:fs/promises');
      const MAX_FILES = 5000;
      const files: Array<{ absolutePath: string; relativePath: string }> = [];
      let truncated = false;
      const walk = async (dir: string, rel: string): Promise<void> => {
        const entries = await fsP.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (files.length >= MAX_FILES) {
            truncated = true;
            return;
          }
          if (entry.name.startsWith('.')) continue;
          const absolutePath = join(dir, entry.name);
          const relativePath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(absolutePath, relativePath);
          } else if (entry.isFile()) {
            files.push({ absolutePath, relativePath });
          }
        }
      };
      await walk(rootPath, '');
      sendJson(res, 200, { files, truncated });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/files/resolve — resolve hint path to existing file (preview entry)
  if (url.pathname === '/api/files/resolve' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ path: string }>(req);
      const raw = body.path?.trim() || '';
      const resolved = resolveWorkspaceFilePath(raw);
      const exists = existsSync(resolved);
      sendJson(res, 200, { path: resolved, exists, requested: raw });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  // POST /api/files/stat — batch existence check for local paths (preview gating)
  if (url.pathname === '/api/files/stat' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ paths: string[] }>(req);
      const fsP = await import('node:fs/promises');
      const exists: Record<string, boolean> = {};
      const sizes: Record<string, number> = {};
      for (const rawPath of (body.paths || []).slice(0, 200)) {
        try {
          const stat = await fsP.stat(resolveWorkspaceFilePath(rawPath));
          exists[rawPath] = stat.isFile();
          sizes[rawPath] = stat.isFile() ? stat.size : 0;
        } catch {
          exists[rawPath] = false;
          sizes[rawPath] = 0;
        }
      }
      sendJson(res, 200, { exists, sizes });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/upload-temp' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        filePath: string;
        fileName?: string;
        cwd?: string;
        bizTypeEnum?: 'temp' | 'workflow' | 'LLM' | 'skill' | 'claw_tiny_file';
        expiresSeconds?: number;
        /** Diagnostics tag for Main log grep, e.g. `dingtalk-share`. */
        source?: string;
        includeDebugCurl?: boolean;
      }>(req);
      const rawPath = body.filePath?.trim() || '';
      if (!rawPath) {
        sendJson(res, 400, { success: false, error: 'Missing filePath' });
        return true;
      }
      const filePath = resolveTempOssUploadPath(rawPath, body.cwd);
      await validateTempOssUploadFile(filePath);
      const fileName = body.fileName?.trim() || filePath.split(/[\\/]/).pop() || 'file';
      const uploaded = await uploadOssFile(filePath, fileName, {
        bizTypeEnum: body.bizTypeEnum ?? 'temp',
        expiresSeconds: body.expiresSeconds,
        logTag: body.source?.trim() || undefined,
        includeDebugCurl: body.includeDebugCurl === true,
      });
      sendJson(res, 200, {
        url: uploaded.tempUrl,
        tempUrl: uploaded.tempUrl,
        ossKey: uploaded.ossKey,
        resourceId: uploaded.resourceId,
        fileType: uploaded.fileType,
        name: uploaded.name,
        ...(uploaded.debugCurl ? { debugCurl: uploaded.debugCurl } : {}),
      });
    } catch (error) {
      sendJson(res, fileRouteErrorStatus(error), {
        success: false,
        errCode: (error as { errCode?: string })?.errCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (url.pathname === '/api/files/read' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ filePath: string; encoding?: 'utf-8' | 'base64' }>(req);
      const filePath = resolveWorkspaceFilePath(body.filePath);
      const encoding = body.encoding || 'utf-8';
      if (encoding === 'base64') {
        const buf = await readFileWithFallback(filePath);
        sendJson(res, 200, { content: buf.toString('base64'), encoding: 'base64' });
      } else {
        const buf = await readFileWithFallback(filePath);
        sendJson(res, 200, { content: buf.toString('utf-8'), encoding: 'utf-8' });
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/serve' && req.method === 'GET') {
    try {
      const rawPath = url.searchParams.get('path');
      if (!rawPath) {
        sendJson(res, 400, { success: false, error: 'Missing path parameter' });
        return true;
      }
      const filePath = resolveWorkspaceFilePath(rawPath);
      const buf = await readFileWithFallback(filePath);
      const ext = extname(filePath).toLowerCase();
      const mimeType = getMimeType(ext);
      res.setHeader('Content-Type', mimeType);
      res.statusCode = 200;
      res.end(buf);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/files/save-image' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        base64?: string;
        mimeType?: string;
        filePath?: string;
        defaultFileName: string;
      }>(req);
      const ext = body.defaultFileName.includes('.')
        ? body.defaultFileName.split('.').pop()!
        : (body.mimeType?.split('/')[1] || 'png');
      const result = await dialog.showSaveDialog({
        defaultPath: join(homedir(), 'Downloads', body.defaultFileName),
        filters: [
          { name: 'Images', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        sendJson(res, 200, { success: false });
        return true;
      }
      const fsP = await import('node:fs/promises');
      if (body.filePath) {
        await fsP.copyFile(body.filePath, result.filePath);
      } else if (body.base64) {
        await fsP.writeFile(result.filePath, Buffer.from(body.base64, 'base64'));
      } else {
        sendJson(res, 400, { success: false, error: 'No image data provided' });
        return true;
      }
      sendJson(res, 200, { success: true, savedPath: result.filePath });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clipboard/write-text' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ text: string }>(req);
      writeTextToSystemClipboard(body.text ?? '');
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clipboard/write-files' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        files: Array<{ filePath: string; fileName: string; mimeType?: string }>;
      }>(req);
      const result = await writeFilesToSystemClipboard(
        Array.isArray(body.files) ? body.files : [],
      );
      sendJson(res, 200, { success: true, copiedFileCount: result.copiedFileCount });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
