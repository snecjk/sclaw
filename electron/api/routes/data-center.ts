import type { IncomingMessage, ServerResponse } from 'http';
import { basename, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { getStoToken } from '../../utils/auth-store';
import { resolveStoBaseUrl } from '../../utils/sto-domain';
import { buildStoMemoryCenterAuthHeaders } from '../../utils/sto-memory-api-auth';
import { resolveWorkspaceFilePath } from '../../utils/artifact-path';
import { logger } from '../../utils/logger';

const MAX_DATA_CENTER_FILE_BYTES = 200 * 1024 * 1024;

const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
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

interface UploadDriveBody {
  filePath?: string;
  fileName?: string;
  parentEntryId?: string;
  idempotencyKey?: string;
}

interface UploadArtifactBody extends UploadDriveBody {
  sourceType?: 'chat_artifact' | 'workflow_artifact';
  sessionId?: string;
  artifactKey?: string;
  messageId?: string;
  runId?: string;
  workflowTemplateId?: string;
  workflowRunId?: string;
}

function inferMimeType(fileName: string): string {
  return EXT_MIME_MAP[extname(fileName).toLowerCase()] || 'application/octet-stream';
}

function appendOptional(form: FormData, key: string, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) form.append(key, trimmed);
}

async function buildUploadForm(body: UploadDriveBody): Promise<{ form: FormData; fileName: string; size: number }> {
  const rawPath = body.filePath?.trim() || '';
  if (!rawPath) throw Object.assign(new Error('Missing filePath'), { statusCode: 400 });
  const idempotencyKey = body.idempotencyKey?.trim() || '';
  if (!idempotencyKey) throw Object.assign(new Error('Missing idempotencyKey'), { statusCode: 400 });

  let buffer: Buffer;
  let fileName = body.fileName?.trim() || '';
  let contentType = '';

  if (/^https?:\/\//i.test(rawPath)) {
    const remote = await fetch(rawPath);
    if (!remote.ok) throw Object.assign(new Error(`下载产物失败 (${remote.status})`), { statusCode: 502 });
    const arrayBuffer = await remote.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    contentType = remote.headers.get('content-type') || '';
    if (!fileName) {
      try {
        fileName = decodeURIComponent(new URL(rawPath).pathname.split('/').pop() || '');
      } catch {
        fileName = '';
      }
    }
  } else {
    const filePath = resolveWorkspaceFilePath(rawPath);
    const info = await stat(filePath);
    if (!info.isFile()) throw Object.assign(new Error('Selected path is not a file'), { statusCode: 400 });
    fileName = fileName || basename(filePath) || 'file';
    buffer = await readFile(filePath);
  }

  if (buffer.length <= 0) throw Object.assign(new Error('文件不能为空'), { statusCode: 413, errCode: 'FILE_TOO_LARGE' });
  if (buffer.length > MAX_DATA_CENTER_FILE_BYTES) {
    throw Object.assign(new Error('文件不能超过 200 MiB'), { statusCode: 413, errCode: 'FILE_TOO_LARGE' });
  }

  fileName = fileName || 'file';
  const blob = new Blob([buffer], { type: contentType || inferMimeType(fileName) });
  const form = new FormData();
  form.append('file', blob, fileName);
  form.append('parentEntryId', body.parentEntryId?.trim() || 'root');
  form.append('idempotencyKey', idempotencyKey);
  return { form, fileName, size: buffer.length };
}

async function forwardDataCenterUpload(path: string, form: FormData): Promise<{ status: number; json: unknown }> {
  const token = await getStoToken();
  if (!token) throw Object.assign(new Error('未登录或 stoToken 已过期，请重新登录'), { statusCode: 401 });

  const baseUrl = await resolveStoBaseUrl();
  const targetUrl = `${baseUrl}/agent/v1/data-center${path}`;
  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: buildStoMemoryCenterAuthHeaders(token),
    body: form,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { success: false, errMessage: text || `HTTP ${response.status}` };
  }
  return { status: response.status, json };
}

function resolveStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) return statusCode;
  }
  return 500;
}

export async function handleDataCenterRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  _ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/data-center/files/upload' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<UploadDriveBody>(req);
      const { form, fileName, size } = await buildUploadForm(body);
      logger.info(`[data-center] upload drive file name=${fileName} size=${size}`);
      const result = await forwardDataCenterUpload('/files/upload', form);
      sendJson(res, result.status, result.json);
    } catch (error) {
      logger.warn(`[data-center] upload drive failed: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, resolveStatusCode(error), {
        success: false,
        errCode: (error as { errCode?: string })?.errCode,
        errMessage: error instanceof Error ? error.message : String(error),
        data: null,
      });
    }
    return true;
  }

  if (url.pathname === '/api/data-center/artifacts/upload' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<UploadArtifactBody>(req);
      if (body.sourceType !== 'chat_artifact' && body.sourceType !== 'workflow_artifact') {
        throw Object.assign(new Error('Missing sourceType'), { statusCode: 400 });
      }
      if (!body.sessionId?.trim()) throw Object.assign(new Error('Missing sessionId'), { statusCode: 400 });
      if (!body.artifactKey?.trim()) throw Object.assign(new Error('Missing artifactKey'), { statusCode: 400 });

      const { form, fileName, size } = await buildUploadForm(body);
      form.append('sourceType', body.sourceType);
      form.append('sessionId', body.sessionId.trim());
      form.append('artifactKey', body.artifactKey.trim());
      appendOptional(form, 'messageId', body.messageId);
      appendOptional(form, 'runId', body.runId);
      appendOptional(form, 'workflowTemplateId', body.workflowTemplateId);
      appendOptional(form, 'workflowRunId', body.workflowRunId);

      logger.info(`[data-center] upload artifact file name=${fileName} size=${size} sourceType=${body.sourceType}`);
      const result = await forwardDataCenterUpload('/artifacts/upload', form);
      sendJson(res, result.status, result.json);
    } catch (error) {
      logger.warn(`[data-center] upload artifact failed: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(res, resolveStatusCode(error), {
        success: false,
        errCode: (error as { errCode?: string })?.errCode,
        errMessage: error instanceof Error ? error.message : String(error),
        data: null,
      });
    }
    return true;
  }

  return false;
}
