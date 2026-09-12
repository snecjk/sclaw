import { createSclawCapabilityToken } from '../../../../shared/agent-extensions';

export const OSS_TINY_FILE_EXPIRES_SECONDS = 24 * 60 * 60;

export interface StoOssTinyFileUploadInput {
  filePath: string;
  fileName?: string;
  cwd?: string;
  signal?: AbortSignal;
}

export interface StoOssTinyFileUploadResult {
  url: string;
  tempUrl: string;
  ossKey: string;
  resourceId: string;
  fileType: string | null;
  name: string | null;
}

export interface StoOssTinyFilePort {
  upload(input: StoOssTinyFileUploadInput): Promise<StoOssTinyFileUploadResult>;
}

export const STO_OSS_TINY_FILE_CAPABILITY = createSclawCapabilityToken<StoOssTinyFilePort>(
  'sto.oss-tiny-file',
);
