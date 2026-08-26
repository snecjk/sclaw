/** Guest-facing composer fill segments for `chat.fillComposer`. */

export type BridgeComposerFillSegment =
  | { type: 'text'; text: string }
  | { type: 'skill'; slug: string; title?: string }
  | { type: 'workflow'; id: string; name?: string };

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isBridgeComposerFillSegment(value: unknown): value is BridgeComposerFillSegment {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type === 'text') {
    return readString(record.text).length > 0;
  }
  if (type === 'skill') {
    return readString(record.slug).length > 0;
  }
  if (type === 'workflow') {
    return readString(record.id).length > 0;
  }
  return false;
}

export function normalizeBridgeComposerFillSegment(value: unknown): BridgeComposerFillSegment | null {
  if (!isBridgeComposerFillSegment(value)) return null;
  if (value.type === 'text') {
    return { type: 'text', text: value.text.trim() };
  }
  if (value.type === 'skill') {
    const slug = value.slug.trim();
    const title = readString(value.title);
    return title ? { type: 'skill', slug, title } : { type: 'skill', slug };
  }
  const id = value.id.trim();
  const name = readString(value.name);
  return name ? { type: 'workflow', id, name } : { type: 'workflow', id };
}

/**
 * Normalize `chat.fillComposer` content.
 * At least one of `text` or non-empty `segments` is required.
 */
export function normalizeBridgeComposerFillInput(input: {
  text?: unknown;
  segments?: unknown;
}): BridgeComposerFillSegment[] | null {
  const rawSegments = Array.isArray(input.segments) ? input.segments : [];
  const normalizedSegments = rawSegments
    .map((entry) => normalizeBridgeComposerFillSegment(entry))
    .filter((entry): entry is BridgeComposerFillSegment => entry !== null);

  if (normalizedSegments.length > 0) {
    return normalizedSegments;
  }

  const text = readString(input.text);
  if (!text) return null;
  return [{ type: 'text', text }];
}

/** Best-effort plain text for legacy seed / send fallback. */
export function bridgeComposerFillPlainText(segments: BridgeComposerFillSegment[]): string {
  let plainText = '';
  for (const seg of segments) {
    if (seg.type === 'text') {
      plainText += seg.text;
      continue;
    }
    if (seg.type === 'workflow') {
      plainText += seg.name?.trim() || seg.id;
    }
  }
  return plainText.trim();
}
