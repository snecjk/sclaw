import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ArtifactSaveItem } from './types';

const MEDIA_ATTACHED_REGEX = /\[media attached:\s*([^\n\r(]+?)\s*\(([^)]+)\)\s*\|\s*([^\]]*)\]/g;
const MARKDOWN_LOCAL_LINK_REGEX = /\[[^\]]+\]\((\/[^)\n\r]+)\)/g;

function cleanPath(value: string): string {
  return value.trim().replace(/^file:\/\//, '');
}

function makeKey(filePath: string, index: number): string {
  return `${index + 1}:${basename(filePath) || filePath}`;
}

async function toArtifact(filePath: string, name: string | undefined, contentType: string | undefined, index: number): Promise<ArtifactSaveItem | null> {
  const cleaned = cleanPath(filePath);
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return null;
  try {
    const info = await stat(cleaned);
    if (!info.isFile()) return null;
    return {
      artifactKey: makeKey(cleaned, index),
      name: name?.trim() || basename(cleaned) || `artifact-${index + 1}`,
      filePath: cleaned,
      contentType: contentType?.trim() || null,
      size: info.size,
    };
  } catch {
    return null;
  }
}

export async function collectArtifactsFromAssistantText(text: string): Promise<ArtifactSaveItem[]> {
  const candidates: Array<{ filePath: string; name?: string; contentType?: string }> = [];
  for (const match of text.matchAll(MEDIA_ATTACHED_REGEX)) {
    candidates.push({
      filePath: match[1],
      contentType: match[2],
      name: match[3] || undefined,
    });
  }
  for (const match of text.matchAll(MARKDOWN_LOCAL_LINK_REGEX)) {
    candidates.push({ filePath: match[1] });
  }

  const seen = new Set<string>();
  const artifacts: ArtifactSaveItem[] = [];
  for (const candidate of candidates) {
    const cleaned = cleanPath(candidate.filePath);
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    const artifact = await toArtifact(cleaned, candidate.name, candidate.contentType, artifacts.length);
    if (artifact) artifacts.push(artifact);
  }
  return artifacts;
}
