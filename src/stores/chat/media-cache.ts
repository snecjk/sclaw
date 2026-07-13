import type { AttachedFileMeta } from './types';

const IMAGE_CACHE_KEY = 'stoclaw:image-cache';
const IMAGE_CACHE_MAX = 100;

const imageCache = loadImageCache();

export function getCachedAttachedFile(filePath: string): AttachedFileMeta | undefined {
  return imageCache.get(filePath);
}

export function upsertImageCacheEntry(filePath: string, file: Omit<AttachedFileMeta, 'filePath'>): void {
  imageCache.set(filePath, { ...file, filePath });
  saveImageCache();
}

function loadImageCache(): Map<string, AttachedFileMeta> {
  try {
    const raw = localStorage.getItem(IMAGE_CACHE_KEY);
    if (raw) return new Map(JSON.parse(raw) as Array<[string, AttachedFileMeta]>);
  } catch { /* ignore parse errors */ }
  return new Map();
}

function saveImageCache(): void {
  try {
    const entries = Array.from(imageCache.entries());
    localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(
      entries.length > IMAGE_CACHE_MAX ? entries.slice(entries.length - IMAGE_CACHE_MAX) : entries,
    ));
  } catch { /* ignore quota errors */ }
}
