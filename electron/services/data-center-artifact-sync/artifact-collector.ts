import { createHash } from 'node:crypto';
import { basename, normalize } from 'node:path';
import { stat } from 'node:fs/promises';
import type { ArtifactSaveItem } from './types';
import { resolveWorkspaceFilePath } from '../../utils/artifact-path';
import { isWindowsDrivePath, PREVIEWABLE_FILE_EXT_PATTERN, stripFileUrlScheme } from '../../../shared/artifact-path';

const MEDIA_ATTACHED_REGEX = /\[media attached:\s*([^\n\r(]+?)\s*\(([^)]+)\)\s*\|\s*([^\]]*)\]/g;
const MARKDOWN_LINK_REGEX = /\[([^\]\n]+)\]\(([^)\n\r]+)\)/g;
const PREVIEW_PATH_REGEX = new RegExp(
  `(?:^|[\\s:：])((?:preview://|file://)?(?:\\./)?[^\\s)\\]"'<>]+\\.(?:${PREVIEWABLE_FILE_EXT_PATTERN}))(?=$|[\\s)\\]"'<>])`,
  'gi',
);

function cleanPath(value: string): string {
  const trimmed = value.trim().replace(/^preview:\/\//, '');
  let filePath = stripFileUrlScheme(trimmed);
  if (!filePath || /^https?:\/\//i.test(filePath) || filePath.startsWith('artifact://')) return filePath;
  // Workflow/file URIs may percent-encode non-ASCII characters (e.g. Chinese names in markdown links).
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // malformed URI sequence: keep original path
  }
  if (filePath.startsWith('/')) return normalize(filePath);
  if (isWindowsDrivePath(filePath)) return filePath.replace(/\\/g, '/');
  return resolveWorkspaceFilePath(filePath);
}

function makeKey(filePath: string): string {
  const digest = createHash('sha256').update(filePath).digest('base64url').slice(0, 16);
  return `${digest}:${basename(filePath) || filePath}`;
}

async function toArtifact(filePath: string, name: string | undefined, contentType: string | undefined): Promise<ArtifactSaveItem | null> {
  const cleaned = cleanPath(filePath);
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return null;
  try {
    const info = await stat(cleaned);
    if (!info.isFile()) return null;
    return {
      artifactKey: makeKey(cleaned),
      name: name?.trim() || basename(cleaned) || 'artifact',
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
  const trimmed = value.trim().replace(/^preview:\/\//, '');
  if (!trimmed || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('artifact://')) return false;
  return trimmed.startsWith('/')
    || trimmed.startsWith('file://')
    || trimmed.startsWith('./')
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
    const artifact = await toArtifact(cleaned, candidate.name, candidate.contentType);
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
  for (const match of text.matchAll(MARKDOWN_LINK_REGEX)) {
    if (!isLocalPath(match[2])) continue;
    candidates.push({
      name: match[1],
      filePath: match[2],
    });
  }
  for (const match of text.matchAll(PREVIEW_PATH_REGEX)) {
    const filePath = match[1];
    if (!filePath || !isLocalPath(filePath)) continue;
    candidates.push({ filePath });
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
    const artifact = await toArtifact(cleaned, candidate.name, candidate.contentType);
    if (artifact) artifacts.push(artifact);
  }
  return artifacts;
}
