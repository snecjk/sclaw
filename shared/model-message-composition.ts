export const MODEL_MESSAGE_COMPOSITION_VERSION = 1 as const;

export type ModelMessageAttachmentProvenance =
  | { kind: 'local' }
  | {
    kind: 'data_center';
    spaceType: 'drive' | 'qa_artifact' | 'site_shared_artifact';
    spaceId?: string | null;
    entryId: string;
  };

export type ModelMessageCompositionSegment =
  | { type: 'text'; text: string }
  | { type: 'attachment'; mediaIndex: number; displayName: string }
  | { type: 'skill'; slug: string; title: string }
  | { type: 'workflow'; id: string; name: string; source?: string }
  | { type: 'mention'; displayName: string; mentionIndex?: number };

export interface ModelMessageCompositionV1 {
  version: typeof MODEL_MESSAGE_COMPOSITION_VERSION;
  segments: ModelMessageCompositionSegment[];
}

/** Stable matching key for user-turn history projection; never used as model input. */
export function modelMessageTextFingerprint(value: string): string {
  return value
    .replace(/<file\b[^>]*><\/file>/gi, '')
    .replace(/\[media attached:[^\]]*]/gi, '')
    .replace(/\[(?:文件|技能):[^\]]*]/g, '')
    .replace(/<!--\s*SClaw-Skill[\s\S]*?-->/gi, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

export function isModelMessageCompositionV1(value: unknown): value is ModelMessageCompositionV1 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== MODEL_MESSAGE_COMPOSITION_VERSION || !Array.isArray(record.segments)) {
    return false;
  }
  return record.segments.every((segment) => {
    if (!segment || typeof segment !== 'object') return false;
    const item = segment as Record<string, unknown>;
    switch (item.type) {
      case 'text':
        return typeof item.text === 'string';
      case 'attachment':
        return Number.isInteger(item.mediaIndex)
          && Number(item.mediaIndex) >= 0
          && typeof item.displayName === 'string';
      case 'skill':
        return typeof item.slug === 'string' && typeof item.title === 'string';
      case 'workflow':
        return typeof item.id === 'string'
          && typeof item.name === 'string'
          && (item.source === undefined || typeof item.source === 'string');
      case 'mention':
        return typeof item.displayName === 'string'
          && (item.mentionIndex === undefined
            || (Number.isInteger(item.mentionIndex) && Number(item.mentionIndex) >= 0));
      default:
        return false;
    }
  });
}

export interface PersistedCompositionSegmentLike {
  type?: string;
  text?: string;
  fileName?: string;
  filePath?: string;
  stagedPath?: string;
  slug?: string;
  title?: string;
  id?: string;
  name?: string;
  source?: string;
  mention?: { displayName?: string };
}

export interface CompositionMediaLike {
  fileName: string;
  filePath?: string;
  stagedPath?: string;
}

export function renderModelWorkflowInstruction(id: string, name: string): string {
  return `帮我执行 id 为：${id} 的工作流 【${name}】`;
}

export function escapeModelFileAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Canonical in-prompt reference for an explicitly selected Skill. */
export function renderModelSkillReference(slug: string, title: string): string {
  const normalizedSlug = slug.trim();
  const normalizedTitle = title.trim() || normalizedSlug;
  return `<skill slug="${escapeModelFileAttribute(normalizedSlug)}" name="${escapeModelFileAttribute(normalizedTitle)}"></skill>`;
}

/** Canonical in-prompt reference for a file dependency, shared by every engine. */
export function renderModelFileReference(filePath: string, displayName: string): string {
  const normalizedDisplayName = displayName.trim();
  const displayNameAttribute = normalizedDisplayName
    ? ` display_name="${escapeModelFileAttribute(normalizedDisplayName)}"`
    : '';
  return `<file name="${escapeModelFileAttribute(filePath)}"${displayNameAttribute}></file>`;
}

export function createModelMessageComposition(
  segments: ModelMessageCompositionSegment[],
): ModelMessageCompositionV1 {
  return { version: MODEL_MESSAGE_COMPOSITION_VERSION, segments };
}

export function buildModelCompositionFromPersistedSegments(input: {
  segments: PersistedCompositionSegmentLike[];
  media: CompositionMediaLike[];
  appendUnmatchedMedia?: boolean;
}): ModelMessageCompositionV1 {
  const result: ModelMessageCompositionSegment[] = [];
  const usedMedia = new Set<number>();
  let mentionIndex = 0;
  for (const segment of input.segments) {
    switch (segment.type) {
      case 'text':
        if (typeof segment.text === 'string') result.push({ type: 'text', text: segment.text });
        break;
      case 'mention':
        if (typeof segment.mention?.displayName === 'string') {
          result.push({ type: 'mention', displayName: segment.mention.displayName, mentionIndex });
          mentionIndex += 1;
        }
        break;
      case 'skill':
        if (typeof segment.slug === 'string') {
          result.push({
            type: 'skill',
            slug: segment.slug,
            title: typeof segment.title === 'string' ? segment.title : segment.slug,
          });
        }
        break;
      case 'workflow':
        if (typeof segment.id === 'string' && typeof segment.name === 'string') {
          result.push({
            type: 'workflow',
            id: segment.id,
            name: segment.name,
            source: typeof segment.source === 'string' ? segment.source : undefined,
          });
        }
        break;
      case 'file': {
        const segmentPath = segment.stagedPath || segment.filePath || '';
        const mediaIndex = input.media.findIndex((item, index) => {
          if (usedMedia.has(index)) return false;
          const mediaPath = item.stagedPath || item.filePath || '';
          return Boolean(segmentPath && mediaPath && segmentPath === mediaPath)
            || Boolean(segment.fileName && segment.fileName === item.fileName);
        });
        if (mediaIndex >= 0) {
          usedMedia.add(mediaIndex);
          result.push({
            type: 'attachment',
            mediaIndex,
            displayName: segment.fileName || input.media[mediaIndex]!.fileName,
          });
        }
        break;
      }
    }
  }
  if (input.appendUnmatchedMedia) {
    input.media.forEach((item, mediaIndex) => {
      if (!usedMedia.has(mediaIndex)) {
        result.push({ type: 'attachment', mediaIndex, displayName: item.fileName });
      }
    });
  }
  return createModelMessageComposition(result);
}
