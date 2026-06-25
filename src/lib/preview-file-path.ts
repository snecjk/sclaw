import { isHttpUrl, normalizeLocalFilePath } from '@/lib/preview-url';

/** Canonical key for comparing local/remote preview file references (Windows-safe). */
export function normalizePreviewFileKey(filePath?: string, fileName?: string): string {
  const raw = (filePath || fileName || '').trim();
  if (!raw) return '';
  if (isHttpUrl(raw)) return raw;
  return normalizeLocalFilePath(raw).toLowerCase();
}

export function previewFileRefsMatch(
  a: { filePath?: string; fileName?: string },
  b: { filePath?: string; fileName?: string },
): boolean {
  const keyA = normalizePreviewFileKey(a.filePath, a.fileName);
  const keyB = normalizePreviewFileKey(b.filePath, b.fileName);
  if (keyA && keyB && keyA === keyB) return true;

  const nameA = (a.fileName || a.filePath?.split(/[\\/]/).pop() || '').toLowerCase();
  const nameB = (b.fileName || b.filePath?.split(/[\\/]/).pop() || '').toLowerCase();
  return Boolean(nameA && nameB && nameA === nameB);
}

export function dedupeAttachedFiles<T extends {
  filePath?: string;
  fileName: string;
  fileSize?: number;
  preview?: string | null;
}>(files: T[]): T[] {
  const result: T[] = [];
  for (const file of files) {
    const dupIdx = result.findIndex((existing) => previewFileRefsMatch(existing, file));
    if (dupIdx < 0) {
      result.push(file);
      continue;
    }
    const existing = result[dupIdx]!;
    const keep = (file.fileSize ?? 0) >= (existing.fileSize ?? 0) ? file : existing;
    const drop = keep === file ? existing : file;
    result[dupIdx] = {
      ...drop,
      ...keep,
      fileSize: keep.fileSize ?? drop.fileSize,
      preview: keep.preview ?? drop.preview,
    };
  }
  return result;
}

/** Merge tool-attached files and text-extracted refs; prefer entries with fileSize/metadata. */
export function mergePreviewFileLists<T extends {
  filePath?: string;
  fileName: string;
  fileSize?: number;
  preview?: string | null;
  mimeType: string;
}>(primary: T[], secondary: T[]): T[] {
  return dedupeAttachedFiles([...primary, ...secondary]);
}
