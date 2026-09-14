/**
 * 流式 message.delta 的增量载荷：引擎给的是累计快照，IPC 只传新增后缀。
 * Overlay 在 renderer 里用块数组接下后缀，过程中不拼全文；展开/结束时再 join。
 */

export const LIVE_APPEND_KEY = '_liveAppend';
export const LIVE_PARTS_KEY = '_liveParts';
export const LIVE_LENGTH_KEY = '_liveLength';
export const LIVE_FIELD_KEY = '_liveField';
export const LIVE_BLOCK_INDEX_KEY = '_liveBlockIndex';
export const LIVE_TAIL_KEY = '_liveTail';

/** 折叠预览只取末尾，避免为了最后一句去 join 全文。思考折叠可用，正文禁止。 */
export const LIVE_TEXT_TAIL_CHARS = 96;
/** 相邻后缀合成一块，降低 parts 条目数；单次拷贝不超过这块大小。 */
export const LIVE_PART_COALESCE_CHARS = 256;

export type LiveAppendField = 'content' | 'thinking' | 'text';

export interface LiveAppendPatch {
  append: string;
  totalLength: number;
  /** `null` 表示 message.content 是 string，否则是 ContentBlock[] 下标 */
  blockIndex: number | null;
  field: LiveAppendField;
}

export interface LiveDeltaCursor {
  contentIsString: boolean;
  blockCount: number;
  growIndex: number;
  growField: LiveAppendField;
  text: string;
  structureKey: string;
}

export function isLiveAppendPayload(payload: unknown): payload is Record<string, unknown> & {
  [LIVE_APPEND_KEY]: LiveAppendPatch;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const patch = (payload as Record<string, unknown>)[LIVE_APPEND_KEY];
  return isLiveAppendPatch(patch);
}

export function readLiveAppend(payload: unknown): LiveAppendPatch | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const patch = (payload as Record<string, unknown>)[LIVE_APPEND_KEY];
  return isLiveAppendPatch(patch) ? patch : null;
}

function isLiveAppendPatch(value: unknown): value is LiveAppendPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const patch = value as Partial<LiveAppendPatch>;
  return typeof patch.append === 'string'
    && typeof patch.totalLength === 'number'
    && Number.isFinite(patch.totalLength)
    && (patch.blockIndex === null || (typeof patch.blockIndex === 'number' && patch.blockIndex >= 0))
    && (patch.field === 'content' || patch.field === 'thinking' || patch.field === 'text');
}

function contentStructureKey(content: unknown): string {
  if (typeof content === 'string') return 'string';
  if (!Array.isArray(content)) return `other:${typeof content}`;
  return content.map((block, index) => {
    if (!block || typeof block !== 'object') return `${index}:x`;
    const record = block as Record<string, unknown>;
    const type = String(record.type ?? '');
    const id = typeof record.id === 'string' ? record.id : '';
    const isGrowableLast = index === content.length - 1 && (type === 'thinking' || type === 'text');
    if (isGrowableLast) return `${index}:${type}:${id}:grow`;
    const thinkingLen = typeof record.thinking === 'string' ? record.thinking.length : 0;
    const textLen = typeof record.text === 'string' ? record.text.length : 0;
    return `${index}:${type}:${id}:${thinkingLen}:${textLen}`;
  }).join('|');
}

function readGrowField(content: unknown): {
  field: LiveAppendField;
  text: string;
  index: number;
  isString: boolean;
  blockCount: number;
} | null {
  if (typeof content === 'string') {
    return { field: 'content', text: content, index: -1, isString: true, blockCount: 0 };
  }
  if (!Array.isArray(content) || content.length === 0) return null;
  const lastIndex = content.length - 1;
  const last = content[lastIndex];
  if (!last || typeof last !== 'object') return null;
  const record = last as Record<string, unknown>;
  if (record.type === 'thinking' && typeof record.thinking === 'string') {
    return {
      field: 'thinking',
      text: record.thinking,
      index: lastIndex,
      isString: false,
      blockCount: content.length,
    };
  }
  if (record.type === 'text' && typeof record.text === 'string') {
    return {
      field: 'text',
      text: record.text,
      index: lastIndex,
      isString: false,
      blockCount: content.length,
    };
  }
  return null;
}

function cursorFromGrow(
  grow: NonNullable<ReturnType<typeof readGrowField>>,
  structureKey: string,
): LiveDeltaCursor {
  return {
    contentIsString: grow.isString,
    blockCount: grow.blockCount,
    growIndex: grow.index,
    growField: grow.field,
    text: grow.text,
    structureKey,
  };
}

export function buildLiveDeltaPayload(
  cursor: LiveDeltaCursor | null,
  message: Record<string, unknown>,
): { payload: unknown; cursor: LiveDeltaCursor | null } {
  const content = message.content;
  const grow = readGrowField(content);
  const structureKey = contentStructureKey(content);
  const nextCursor = grow ? cursorFromGrow(grow, structureKey) : null;

  if (
    cursor
    && grow
    && cursor.structureKey === structureKey
    && grow.field === cursor.growField
    && grow.index === cursor.growIndex
    && grow.text.startsWith(cursor.text)
    && grow.text.length > cursor.text.length
  ) {
    const { content: _omit, ...meta } = message;
    return {
      payload: {
        ...meta,
        [LIVE_APPEND_KEY]: {
          append: grow.text.slice(cursor.text.length),
          totalLength: grow.text.length,
          blockIndex: grow.index < 0 ? null : grow.index,
          field: grow.field,
        } satisfies LiveAppendPatch,
      },
      cursor: nextCursor,
    };
  }

  return { payload: message, cursor: nextCursor };
}

type OverlayMessage = {
  role?: unknown;
  content?: unknown;
  id?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
};

export function liveTextTail(parts: readonly string[], maxChars = LIVE_TEXT_TAIL_CHARS): string {
  if (maxChars <= 0 || parts.length === 0) return '';
  let out = '';
  for (let index = parts.length - 1; index >= 0 && out.length < maxChars; index -= 1) {
    out = `${parts[index] ?? ''}${out}`;
  }
  return out.length > maxChars ? out.slice(-maxChars) : out;
}

/** 正文 / 解析必须拼回全文；禁止把 `_liveTail` 当成交付内容。 */
export function liveTextFull(parts: readonly string[]): string {
  return parts.join('');
}

function readLiveParts(message: OverlayMessage | null): string[] | null {
  if (!message || !Array.isArray(message[LIVE_PARTS_KEY])) return null;
  return message[LIVE_PARTS_KEY] as string[];
}

function readSeedText(previous: OverlayMessage | null, patch: LiveAppendPatch): string {
  if (patch.blockIndex === null || patch.field === 'content') {
    return typeof previous?.content === 'string' ? previous.content : '';
  }
  const blocks = Array.isArray(previous?.content) ? previous.content : [];
  const current = blocks[patch.blockIndex];
  if (!current || typeof current !== 'object') return '';
  const field = patch.field === 'thinking' ? 'thinking' : 'text';
  const value = (current as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function appendLivePart(parts: string[], chunk: string): void {
  if (!chunk) return;
  const lastIndex = parts.length - 1;
  const last = lastIndex >= 0 ? parts[lastIndex] ?? '' : '';
  if (lastIndex >= 0 && last.length + chunk.length <= LIVE_PART_COALESCE_CHARS) {
    parts[lastIndex] = `${last}${chunk}`;
    return;
  }
  parts.push(chunk);
}

function inheritLiveParts(previous: OverlayMessage | null, patch: LiveAppendPatch): string[] {
  const existing = readLiveParts(previous);
  if (
    existing
    && previous?.[LIVE_FIELD_KEY] === patch.field
    && previous?.[LIVE_BLOCK_INDEX_KEY] === patch.blockIndex
  ) {
    appendLivePart(existing, patch.append);
    return existing;
  }
  const seed = readSeedText(previous, patch);
  const parts = seed ? [seed] : [];
  appendLivePart(parts, patch.append);
  return parts;
}

function stripLiveAppend(payload: Record<string, unknown>): OverlayMessage {
  const { [LIVE_APPEND_KEY]: _patch, ...rest } = payload;
  return rest;
}

function stripLiveRope(message: OverlayMessage): OverlayMessage {
  const {
    [LIVE_PARTS_KEY]: _parts,
    [LIVE_LENGTH_KEY]: _length,
    [LIVE_FIELD_KEY]: _field,
    [LIVE_BLOCK_INDEX_KEY]: _index,
    [LIVE_TAIL_KEY]: _tail,
    ...rest
  } = message;
  return rest;
}

/** 流结束 / 展开时才 join；delta 路径禁止每帧拼全文。 */
export function materializeLiveMessage(message: OverlayMessage | null): OverlayMessage | null {
  if (!message) return null;
  const parts = readLiveParts(message);
  if (!parts || parts.length === 0) return stripLiveRope(message);
  const joined = parts.join('');
  const field = message[LIVE_FIELD_KEY];
  const blockIndex = message[LIVE_BLOCK_INDEX_KEY];
  const rest = stripLiveRope(message);
  if (blockIndex === null || field === 'content' || typeof rest.content === 'string') {
    return { ...rest, content: joined };
  }
  const sourceBlocks = Array.isArray(rest.content) ? [...rest.content] : [];
  const blocks = sourceBlocks.map((block) => (
    block && typeof block === 'object' ? { ...(block as Record<string, unknown>) } : block
  ));
  const index = typeof blockIndex === 'number' ? blockIndex : blocks.length - 1;
  while (blocks.length <= index) {
    blocks.push({ type: field === 'thinking' ? 'thinking' : 'text' });
  }
  const current = blocks[index];
  const block = current && typeof current === 'object'
    ? { ...(current as Record<string, unknown>) }
    : { type: field === 'thinking' ? 'thinking' : 'text' };
  const textField = field === 'thinking' ? 'thinking' : 'text';
  block.type = block.type ?? (field === 'thinking' ? 'thinking' : 'text');
  block[textField] = joined;
  blocks[index] = block;
  return { ...rest, content: blocks };
}

export function readLiveStreamParts(message: unknown): {
  parts: string[];
  field: LiveAppendField;
  blockIndex: number | null;
  tail: string;
  length: number;
} | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const record = message as OverlayMessage;
  const parts = readLiveParts(record);
  if (!parts || parts.length === 0) return null;
  const field = record[LIVE_FIELD_KEY];
  const blockIndex = record[LIVE_BLOCK_INDEX_KEY];
  const length = record[LIVE_LENGTH_KEY];
  return {
    parts,
    field: field === 'thinking' || field === 'text' || field === 'content' ? field : 'thinking',
    blockIndex: typeof blockIndex === 'number' ? blockIndex : null,
    tail: typeof record[LIVE_TAIL_KEY] === 'string'
      ? record[LIVE_TAIL_KEY] as string
      : liveTextTail(parts),
    length: typeof length === 'number' ? length : parts.reduce((sum, part) => sum + part.length, 0),
  };
}

export function applyLiveMessagePayload(
  previous: OverlayMessage | null,
  payload: unknown,
): OverlayMessage | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return previous;
  const record = payload as Record<string, unknown>;
  const patch = readLiveAppend(record);
  const meta = stripLiveAppend(record);
  if (!patch) {
    if (readLiveParts(meta)) {
      return {
        ...previous,
        ...meta,
        role: meta.role ?? previous?.role ?? 'assistant',
      };
    }
    const cleaned = stripLiveRope(meta);
    return Object.keys(cleaned).length > 0 ? cleaned : previous;
  }

  const canStartFresh = !previous && patch.totalLength === patch.append.length;
  if (!previous && !canStartFresh) return previous;

  const parts = inheritLiveParts(previous, patch);
  let nextContent = previous?.content;
  if (nextContent === undefined) {
    nextContent = patch.blockIndex === null || patch.field === 'content' ? '' : [];
  }
  if (Array.isArray(nextContent) && typeof patch.blockIndex === 'number') {
    if (nextContent.length <= patch.blockIndex) {
      const blocks = [...nextContent];
      while (blocks.length <= patch.blockIndex) {
        blocks.push({
          type: patch.field === 'thinking' ? 'thinking' : 'text',
        });
      }
      nextContent = blocks;
    }
  }

  return {
    ...previous,
    ...meta,
    role: meta.role ?? previous?.role ?? 'assistant',
    content: nextContent,
    [LIVE_PARTS_KEY]: parts,
    [LIVE_LENGTH_KEY]: patch.totalLength,
    [LIVE_FIELD_KEY]: patch.field,
    [LIVE_BLOCK_INDEX_KEY]: patch.blockIndex,
    [LIVE_TAIL_KEY]: liveTextTail(parts),
  };
}

export function mergeLiveDeltaPayloads(earlier: unknown, later: unknown): unknown {
  const laterPatch = readLiveAppend(later);
  const earlierPatch = readLiveAppend(earlier);
  if (
    laterPatch
    && earlierPatch
    && laterPatch.field === earlierPatch.field
    && laterPatch.blockIndex === earlierPatch.blockIndex
    && later
    && typeof later === 'object'
  ) {
    return {
      ...(later as Record<string, unknown>),
      [LIVE_APPEND_KEY]: {
        ...laterPatch,
        append: earlierPatch.append + laterPatch.append,
      },
    };
  }
  if (laterPatch && !earlierPatch) {
    return applyLiveMessagePayload(
      earlier && typeof earlier === 'object' && !Array.isArray(earlier)
        ? earlier as OverlayMessage
        : null,
      later,
    );
  }
  return later;
}
