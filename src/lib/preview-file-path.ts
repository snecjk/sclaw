import { isHttpUrl, normalizeLocalFilePath } from '@/lib/preview-url';
import { isTruncatedLocalPathPrefix } from '../../shared/preview-raw-path';
import { preferDisplayFileName, stableFileSuffix } from '../../shared/file-display-name';

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
  if (nameA && nameB && nameA === nameB) return true;

  const suffixA = stableFileSuffix(nameA);
  const suffixB = stableFileSuffix(nameB);
  if (suffixA && suffixB && suffixA === suffixB) return true;

  return false;
}

export function dedupeAttachedFiles<T extends {
  filePath?: string;
  fileName: string;
  fileSize?: number;
  preview?: string | null;
}>(files: T[]): T[] {
  const withoutTruncatedSiblings: T[] = [];
  for (const file of files) {
    const fp = file.filePath || file.fileName;
    if (
      fp
      && withoutTruncatedSiblings.some((existing) => {
        const ep = existing.filePath || existing.fileName;
        return ep ? isTruncatedLocalPathPrefix(fp, ep) : false;
      })
    ) {
      continue;
    }
    for (let i = withoutTruncatedSiblings.length - 1; i >= 0; i -= 1) {
      const existing = withoutTruncatedSiblings[i]!;
      const ep = existing.filePath || existing.fileName;
      if (ep && fp && isTruncatedLocalPathPrefix(ep, fp)) {
        withoutTruncatedSiblings.splice(i, 1);
      }
    }
    withoutTruncatedSiblings.push(file);
  }

  const result: T[] = [];
  for (const file of withoutTruncatedSiblings) {
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
      fileName: preferDisplayFileName(keep.fileName, drop.fileName),
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

/** Patch garbled attachment names using labels found in assistant message text. */
export function applyDisplayNameHints<T extends { filePath?: string; fileName: string }>(
  files: T[],
  hints: Array<{ fileName: string }>,
): T[] {
  if (hints.length === 0) return files;
  return files.map((file) => {
    const suffix = stableFileSuffix(file.fileName);
    if (!suffix) return file;
    const hint = hints.find((candidate) => stableFileSuffix(candidate.fileName) === suffix);
    if (!hint) return file;
    return {
      ...file,
      fileName: preferDisplayFileName(hint.fileName, file.fileName),
    };
  });
}
