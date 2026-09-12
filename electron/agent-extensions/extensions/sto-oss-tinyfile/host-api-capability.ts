import { PORTS } from '../../../utils/config';
import {
  OSS_TINY_FILE_EXPIRES_SECONDS,
  type StoOssTinyFilePort,
  type StoOssTinyFileUploadResult,
} from './capability';

type UploadResponse = Partial<StoOssTinyFileUploadResult> & {
  error?: unknown;
  errCode?: string;
  errMessage?: string;
};

function errorMessage(payload: UploadResponse | undefined, response: Response): string {
  if (payload?.errMessage?.trim()) return payload.errMessage.trim();
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (payload?.errCode?.trim()) return payload.errCode.trim();
  return `${response.status} ${response.statusText}`.trim();
}

export function createHostApiOssTinyFilePort(): StoOssTinyFilePort {
  return {
    async upload(input) {
      const response = await fetch(
        `http://127.0.0.1:${PORTS.CLAWX_HOST_API}/api/files/upload-temp`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath: input.filePath,
            fileName: input.fileName,
            cwd: input.cwd,
            bizTypeEnum: 'claw_tiny_file',
            expiresSeconds: OSS_TINY_FILE_EXPIRES_SECONDS,
            source: 'sto-oss-tinyfile',
            includeDebugCurl: false,
          }),
          signal: input.signal,
        },
      );
      const payload = await response.json().catch(() => undefined) as UploadResponse | undefined;
      const url = payload?.tempUrl?.trim() || payload?.url?.trim() || '';
      const ossKey = payload?.ossKey?.trim() || '';
      const resourceId = payload?.resourceId?.trim() || '';
      if (!response.ok) {
        throw new Error(errorMessage(payload, response));
      }
      if (!url || !ossKey || !resourceId) {
        throw new Error('OSS upload response is incomplete');
      }
      return {
        url,
        tempUrl: url,
        ossKey,
        resourceId,
        fileType: payload?.fileType ?? null,
        name: payload?.name ?? null,
      };
    },
  };
}
