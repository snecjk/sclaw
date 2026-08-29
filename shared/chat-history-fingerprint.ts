/**
 * Claude chat.history 对账摘要。
 * 覆盖 JSONL 持久化消息 + liveClaudeMessages 合并结果，避免只 stat 文件导致误判。
 */

export interface ChatHistoryFingerprint {
  mergedCount: number;
  persistedCount: number;
  liveCount: number;
  lastId: string | null;
  lastTimestamp: number | null;
  archivedKey: string;
  contentHash: number;
}

export interface ChatHistoryFingerprintMessage {
  id?: unknown;
  timestamp?: unknown;
  content?: unknown;
}

export function mixContentHash(content: unknown, seed = 2_166_136_261): number {
  const text = typeof content === 'string'
    ? content
    : content == null
      ? ''
      : (() => {
          try {
            return JSON.stringify(content) ?? '';
          } catch {
            return '';
          }
        })();
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function buildArchivedKey(archivedIds: readonly string[] | undefined): string {
  if (!archivedIds?.length) return '';
  return archivedIds.join('\u0000');
}

export function buildChatHistoryFingerprint(input: {
  messages: readonly ChatHistoryFingerprintMessage[];
  persistedCount: number;
  liveCount: number;
  archivedIds?: readonly string[];
}): ChatHistoryFingerprint {
  const last = input.messages[input.messages.length - 1];
  const lastId = typeof last?.id === 'string' && last.id ? last.id : null;
  const lastTimestamp = typeof last?.timestamp === 'number' && Number.isFinite(last.timestamp)
    ? last.timestamp
    : null;
  let contentHash = 2_166_136_261;
  for (const message of input.messages) {
    contentHash = mixContentHash(message.content, contentHash);
    if (typeof message.id === 'string' && message.id) {
      contentHash = mixContentHash(message.id, contentHash);
    }
  }
  return {
    mergedCount: input.messages.length,
    persistedCount: input.persistedCount,
    liveCount: input.liveCount,
    lastId,
    lastTimestamp,
    archivedKey: buildArchivedKey(input.archivedIds),
    contentHash,
  };
}

export function isChatHistoryFingerprint(value: unknown): value is ChatHistoryFingerprint {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.mergedCount === 'number'
    && typeof record.persistedCount === 'number'
    && typeof record.liveCount === 'number'
    && (record.lastId === null || typeof record.lastId === 'string')
    && (record.lastTimestamp === null || typeof record.lastTimestamp === 'number')
    && typeof record.archivedKey === 'string'
    && typeof record.contentHash === 'number';
}

export function chatHistoryFingerprintsEqual(
  left?: ChatHistoryFingerprint | null,
  right?: ChatHistoryFingerprint | null,
): boolean {
  if (!left || !right) return false;
  return left.mergedCount === right.mergedCount
    && left.persistedCount === right.persistedCount
    && left.liveCount === right.liveCount
    && left.lastId === right.lastId
    && left.lastTimestamp === right.lastTimestamp
    && left.archivedKey === right.archivedKey
    && left.contentHash === right.contentHash;
}
