import { readFile } from 'node:fs/promises';
import { getStoToken } from './auth-store';
import { info } from './logger';
import { buildStoMemoryCenterAuthHeaders } from './sto-memory-api-auth';
import { resolveStoBaseUrl } from './sto-domain';
import { proxyAwareFetch } from './proxy-fetch';

/** @see agent-oss-file-api.md */
export const OSS_FILE_UPLOAD_PATH = '/agent/v1/oss-file/upload';
export const OSS_FILE_GET_TEMP_URL_PATH = '/agent/v1/oss-file/getTempUrl';

export type OssBizTypeEnum = 'temp' | 'workflow' | 'LLM' | 'skill';

export type OssFileUploadResult = {
  ossKey: string;
  tempUrl: string;
  fileType: string | null;
  name: string | null;
  /** Last segment of `ossKey`, e.g. `1770000000000_report.xlsx` */
  resourceId: string;
};

export type UploadOssFileOptions = {
  bizTypeEnum?: OssBizTypeEnum;
  expiresSeconds?: number;
};

const DEFAULT_EXPIRES_SECONDS = 86_400;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build a copy-pasteable curl for POST /agent/v1/oss-file/upload (agent-oss-file-api.md).
 */
export function buildOssFileUploadCurl(params: {
  baseUrl: string;
  token: string;
  filePath: string;
  bizTypeEnum?: OssBizTypeEnum;
  expiresSeconds?: number;
}): string {
  const baseUrl = params.baseUrl.replace(/\/+$/, '');
  const bizTypeEnum = params.bizTypeEnum ?? 'temp';
  const expiresSeconds = params.expiresSeconds ?? DEFAULT_EXPIRES_SECONDS;
  const url = `${baseUrl}${OSS_FILE_UPLOAD_PATH}`;
  const token = params.token;
  return [
    `curl -X POST ${shellQuote(url)} \\`,
    `  -H ${shellQuote(`stotoken: ${token}`)} \\`,
    `  -H ${shellQuote(`Authorization: Bearer ${token}`)} \\`,
    `  -F ${shellQuote(`file=@${params.filePath}`)} \\`,
    `  -F ${shellQuote(`biz_type_enum=${bizTypeEnum}`)} \\`,
    `  -F ${shellQuote(`expires_seconds=${expiresSeconds}`)}`,
  ].join('\n');
}

export function resourceIdFromOssKey(ossKey: string): string {
  const trimmed = ossKey.trim();
  if (!trimmed) return '';
  const parts = trimmed.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

export function parseOssFileUploadPayload(payload: unknown): OssFileUploadResult {
  const body = payload as {
    success?: boolean;
    data?: {
      ossKey?: string;
      tempUrl?: string;
      url?: string;
      fileType?: string | null;
      name?: string | null;
    };
    errMessage?: string;
  };

  if (!body?.success || !body.data) {
    throw new Error(body?.errMessage || 'OSS upload failed');
  }

  const ossKey = body.data.ossKey?.trim() || '';
  const tempUrl = body.data.tempUrl?.trim() || body.data.url?.trim() || '';
  if (!ossKey || !tempUrl) {
    throw new Error('OSS upload response missing ossKey or tempUrl');
  }

  return {
    ossKey,
    tempUrl,
    fileType: body.data.fileType ?? null,
    name: body.data.name ?? null,
    resourceId: resourceIdFromOssKey(ossKey),
  };
}

function buildOssUploadFormData(fileBuffer: Buffer, fileName: string, options: UploadOssFileOptions): FormData {
  const formData = new (globalThis as { FormData: new () => FormData }).FormData();
  const BlobCtor = (globalThis as { Blob: new (parts: Array<Buffer>) => Blob }).Blob;
  formData.append('file', new BlobCtor([fileBuffer]), fileName);
  formData.append('biz_type_enum', options.bizTypeEnum ?? 'temp');
  formData.append(
    'expires_seconds',
    String(options.expiresSeconds ?? DEFAULT_EXPIRES_SECONDS),
  );
  return formData;
}

/**
 * Upload a local file via POST /agent/v1/oss-file/upload.
 * @see agent-oss-file-api.md
 */
export async function uploadOssFile(
  filePath: string,
  fileName: string,
  options: UploadOssFileOptions = {},
): Promise<OssFileUploadResult> {
  const token = await getStoToken();
  if (!token) {
    throw new Error('stoToken is missing, cannot upload media to OSS');
  }

  const fileBuffer = await readFile(filePath);
  const baseUrl = await resolveStoBaseUrl();
  const curl = buildOssFileUploadCurl({
    baseUrl,
    token,
    filePath,
    bizTypeEnum: options.bizTypeEnum,
    expiresSeconds: options.expiresSeconds,
  });
  info(`[oss-upload] POST ${baseUrl}${OSS_FILE_UPLOAD_PATH}\n${curl}`);

  const response = await proxyAwareFetch(`${baseUrl}${OSS_FILE_UPLOAD_PATH}`, {
    method: 'POST',
    headers: buildStoMemoryCenterAuthHeaders(token),
    body: buildOssUploadFormData(fileBuffer, fileName, options),
  });

  const rawText = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`OSS upload failed: ${response.status} ${rawText}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error(`OSS upload failed: invalid JSON response (${rawText.slice(0, 200)})`);
  }

  return parseOssFileUploadPayload(payload);
}

/**
 * Refresh a temporary OSS URL by resourceId.
 * @see agent-oss-file-api.md
 */
export async function getOssFileTempUrl(
  resourceId: string,
  expiresSeconds = DEFAULT_EXPIRES_SECONDS,
): Promise<string> {
  const trimmed = resourceId.trim();
  if (!trimmed) {
    throw new Error('resourceId is required');
  }

  const token = await getStoToken();
  if (!token) {
    throw new Error('stoToken is missing, cannot refresh OSS temp URL');
  }

  const baseUrl = await resolveStoBaseUrl();
  const response = await proxyAwareFetch(`${baseUrl}${OSS_FILE_GET_TEMP_URL_PATH}`, {
    method: 'POST',
    headers: {
      ...buildStoMemoryCenterAuthHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resourceId: trimmed,
      expires_seconds: expiresSeconds,
    }),
  });

  const rawText = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`OSS getTempUrl failed: ${response.status} ${rawText}`);
  }

  const payload = JSON.parse(rawText) as {
    success?: boolean;
    data?: { tempUrl?: string; url?: string };
    errMessage?: string;
  };
  const tempUrl = payload.data?.tempUrl?.trim() || payload.data?.url?.trim();
  if (!payload.success || !tempUrl) {
    throw new Error(payload.errMessage || 'OSS getTempUrl response missing tempUrl');
  }
  return tempUrl;
}

/**
 * Upload and return the temporary HTTP URL (`tempUrl`).
 * Used by chat media transform, DingTalk share, etc.
 */
export async function uploadFileToTempOSS(
  filePath: string,
  fileName: string,
  options?: UploadOssFileOptions,
): Promise<string> {
  const result = await uploadOssFile(filePath, fileName, options);
  return result.tempUrl;
}
