import { hostApiFetch } from '@/lib/host-api';
import { extractMediaRefs, getMessageText } from './helpers';
import { upsertImageCacheEntry } from './media-cache';
import type { AttachedFileMeta, RawMessage } from './types';

export function cacheUploadedAttachments(
  attachments: Array<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    stagedPath: string;
    preview: string | null;
  }>,
): void {
  for (const attachment of attachments) {
    upsertImageCacheEntry(attachment.stagedPath, {
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      preview: attachment.preview,
    });
  }
}

/** Fills in persisted attachment thumbnails and file sizes in-place. */
export async function loadMissingPreviews(messages: RawMessage[]): Promise<boolean> {
  const needPreview: Array<{ filePath: string; mimeType: string }> = [];
  const seenPaths = new Set<string>();
  for (const message of messages) {
    if (!message._attachedFiles) continue;
    for (const file of message._attachedFiles) {
      const filePath = file.filePath;
      if (!filePath || seenPaths.has(filePath)) continue;
      if ((file.mimeType.startsWith('image/') && !file.preview)
        || (!file.mimeType.startsWith('image/') && file.fileSize === 0)) {
        seenPaths.add(filePath);
        needPreview.push({ filePath, mimeType: file.mimeType });
      }
    }
    if (message.role !== 'user') continue;
    const refs = extractMediaRefs(getMessageText(message.content));
    for (let index = 0; index < refs.length; index += 1) {
      const file = message._attachedFiles[index];
      const ref = refs[index];
      if (!file || !ref || seenPaths.has(ref.filePath)) continue;
      if ((ref.mimeType.startsWith('image/') && !file.preview)
        || (!ref.mimeType.startsWith('image/') && file.fileSize === 0)) {
        seenPaths.add(ref.filePath);
        needPreview.push(ref);
      }
    }
  }
  if (needPreview.length === 0) return false;

  try {
    const thumbnails = await hostApiFetch<Record<string, { preview: string | null; fileSize: number }>>(
      '/api/files/thumbnails',
      { method: 'POST', body: JSON.stringify({ paths: needPreview }) },
    );
    let updated = false;
    for (const message of messages) {
      if (!message._attachedFiles) continue;
      for (const file of message._attachedFiles) {
        const filePath = file.filePath;
        if (!filePath) continue;
        updated = applyThumbnail(file, filePath, thumbnails) || updated;
      }
      if (message.role !== 'user') continue;
      const refs = extractMediaRefs(getMessageText(message.content));
      for (let index = 0; index < refs.length; index += 1) {
        const file = message._attachedFiles[index];
        const ref = refs[index];
        if (file && ref && !file.filePath) {
          updated = applyThumbnail(file, ref.filePath, thumbnails) || updated;
        }
      }
    }
    return updated;
  } catch (error) {
    console.warn('[loadMissingPreviews] Failed:', error);
    return false;
  }
}

function applyThumbnail(
  file: AttachedFileMeta,
  filePath: string,
  thumbnails: Record<string, { preview: string | null; fileSize: number }>,
): boolean {
  const thumbnail = thumbnails[filePath];
  if (!thumbnail || (!thumbnail.preview && !thumbnail.fileSize)) return false;
  if (thumbnail.preview) file.preview = thumbnail.preview;
  if (thumbnail.fileSize) file.fileSize = thumbnail.fileSize;
  upsertImageCacheEntry(filePath, file);
  return true;
}
