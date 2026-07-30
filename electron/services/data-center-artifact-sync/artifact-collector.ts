import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ArtifactSaveItem } from './types';
import { resolveWorkspaceFilePath } from '../../utils/artifact-path';

const MEDIA_ATTACHED_REGEX = /\[media attached:\s*([^\n\r(]+?)\s*\(([^)]+)\)\s*\|\s*([^\]]*)\]/g;
const MARKDOWN_LOCAL_LINK_REGEX = /\[([^\]]+)\]\(((?:file:\/\/)?\/[^)\n\r]+)\)/g;

function cleanPath(value: string): string {
  const trimmed = value.trim().replace(/^file:\/\//, '');
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('artifact://')) return trimmed;
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return trimmed;
  return resolveWorkspaceFilePath(trimmed);
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
      mtimeMs: info.mtimeMs,
    };
  } catch {
    return null;
  }
}

function isLocalPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('artifact://')) return false;
  return trimmed.startsWith('/')
    || trimmed.startsWith('file://')
    || /^[A-Za-z]:[\\/]/.test(trimmed)
    || /\.[A-Za-z0-9]{1,12}$/.test(trimmed);
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractStructuredRefs(value: unknown, refs: Array<{ filePath: string; name?: string; contentType?: string }>, seenObjects = new WeakSet<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  if (Array.isArray(value)) {
    for (const item of value) extractStructuredRefs(item, refs, seenObjects);
    return;
  }

  const record = value as Record<string, unknown>;
  const filePath = readString(record, ['filePath', 'file_path', 'localPath', 'path', 'uri']);
  if (filePath && isLocalPath(filePath)) {
    refs.push({
      filePath,
      name: readString(record, ['fileName', 'file_name', 'name', 'displayName']),
      contentType: readString(record, ['contentType', 'content_type', 'mimeType', 'mime_type', 'type']),
    });
  }

  for (const key of ['_attachedFiles', 'artifacts', 'processFiles', 'files', 'outputFiles', 'output_files', 'attachments', 'content']) {
    extractStructuredRefs(record[key], refs, seenObjects);
  }
}

function extractTextFragments(value: unknown, fragments: string[], seenObjects = new WeakSet<object>()): void {
  if (!value) return;
  if (typeof value === 'string') {
    fragments.push(value);
    return;
  }
  if (typeof value !== 'object') return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);

  if (Array.isArray(value)) {
    for (const item of value) extractTextFragments(item, fragments, seenObjects);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['content', 'text', 'message', 'markdown']) {
    extractTextFragments(record[key], fragments, seenObjects);
  }
}

export async function collectArtifactsFromAssistantText(text: string): Promise<ArtifactSaveItem[]> {
  const candidates: Array<{ filePath: string; name?: string; contentType?: string }> = [];
  collectCandidatesFromText(text, candidates);

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

function collectCandidatesFromText(text: string, candidates: Array<{ filePath: string; name?: string; contentType?: string }>): void {
  for (const match of text.matchAll(MEDIA_ATTACHED_REGEX)) {
    candidates.push({
      filePath: match[1],
      contentType: match[2],
      name: match[3] || undefined,
    });
  }
  for (const match of text.matchAll(MARKDOWN_LOCAL_LINK_REGEX)) {
    candidates.push({
      name: match[1],
      filePath: match[2],
    });
  }
}

export async function collectArtifactsFromAssistantMessages(messages: unknown[], fallbackText = ''): Promise<ArtifactSaveItem[]> {
  const candidates: Array<{ filePath: string; name?: string; contentType?: string }> = [];
  const textFragments: string[] = [];
  for (const message of messages) {
    extractStructuredRefs(message, candidates);
    extractTextFragments(message, textFragments);
  }
  collectCandidatesFromText([fallbackText, ...textFragments].filter(Boolean).join('\n'), candidates);

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
