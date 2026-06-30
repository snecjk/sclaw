import { readFile } from 'node:fs/promises';
import { getStoToken } from './auth-store';
import { buildStoMemoryCenterAuthHeaders } from './sto-memory-api-auth';
import { resolveStoBaseUrl } from './sto-domain';
import { proxyAwareFetch } from './proxy-fetch';

export const BIZ_AGENT_TEMP_UPLOAD_PATH = '/agent/v1/biz-agent/attachments/upload';

/**
 * Upload a local file to STO biz-agent temp OSS and return the public URL.
 * Used by chat media transform and DingTalk share flows.
 */
export async function uploadFileToTempOSS(filePath: string, fileName: string): Promise<string> {
  const token = await getStoToken();
  if (!token) {
    throw new Error('stoToken is missing, cannot upload media to OSS');
  }

  const fileBuffer = await readFile(filePath);
  const formData = new (globalThis as { FormData: new () => FormData }).FormData();
  const BlobCtor = (globalThis as { Blob: new (parts: Array<Buffer>) => Blob }).Blob;
  formData.append('file', new BlobCtor([fileBuffer]), fileName);

  const baseUrl = await resolveStoBaseUrl();
  const response = await proxyAwareFetch(`${baseUrl}${BIZ_AGENT_TEMP_UPLOAD_PATH}`, {
    method: 'POST',
    headers: buildStoMemoryCenterAuthHeaders(token),
    body: formData,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`temp OSS upload failed: ${response.status} ${bodyText}`);
  }

  const payload = await response.json() as {
    success?: boolean;
    data?: { url?: string };
    url?: string;
  };
  const uploadedUrl = payload.data?.url || payload.url;
  if (!uploadedUrl) {
    throw new Error('temp OSS upload response missing url');
  }
  return uploadedUrl;
}
