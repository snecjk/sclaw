/**
 * 弹窗确认时：下载数据中心文件并 stage 到本地 outbound。
 * 调用方拿到的是已可发送的本地路径，不必再自己 download。
 */
import { hostApiFetch } from '@/lib/host-api';
import { getDataCenterDownloadUrl } from '@/lib/data-center-api';
import { inferMimeTypeFromPath } from '@/lib/preview-url';
import type { DataCenterPickerSelection, DataCenterStagedFile } from './types';

function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** 单个选中项：download-url → fetch → stage-buffer → 本地 stagedPath */
export async function stageDataCenterSelection(
  entry: DataCenterPickerSelection,
): Promise<DataCenterStagedFile> {
  const mimeFallback = entry.mimeType || inferMimeTypeFromPath(entry.name);
  const download = await getDataCenterDownloadUrl(entry.entryId);
  const response = await fetch(download.tempUrl);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const fileName = download.fileName || entry.name;
  const mimeType = download.mimeType || mimeFallback || blob.type || 'application/octet-stream';
  const base64 = await readFileAsBase64(new File([blob], fileName, { type: mimeType }));
  const staged = await hostApiFetch<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>('/api/files/stage-buffer', {
    method: 'POST',
    body: JSON.stringify({
      base64,
      fileName,
      mimeType,
    }),
  });

  return {
    entryId: entry.entryId,
    fileName: staged.fileName || fileName,
    mimeType: staged.mimeType || mimeType,
    fileSize: staged.fileSize || entry.fileSize || 0,
    stagedPath: staged.stagedPath,
    preview: staged.preview,
    spaceType: entry.spaceType,
    spaceId: entry.spaceId ?? null,
  };
}

/** 批量确认：尽量全部成功；单个失败不阻断其余项。 */
export async function stageDataCenterSelections(
  entries: DataCenterPickerSelection[],
): Promise<{ staged: DataCenterStagedFile[]; errors: Array<{ name: string; error: string }> }> {
  const staged: DataCenterStagedFile[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const entry of entries) {
    try {
      staged.push(await stageDataCenterSelection(entry));
    } catch (error) {
      errors.push({
        name: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { staged, errors };
}
