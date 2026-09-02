export type ChatHistoryPaginationMode = 'none' | 'before-id';

export interface ChatHistoryCapabilities {
  paginationMode: ChatHistoryPaginationMode;
  defaultPageSize: number;
}

export function readChatHistoryCapabilities(value: unknown): ChatHistoryCapabilities | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.paginationMode !== 'none' && record.paginationMode !== 'before-id') return null;
  if (
    typeof record.defaultPageSize !== 'number'
    || !Number.isFinite(record.defaultPageSize)
    || record.defaultPageSize <= 0
  ) return null;
  return {
    paginationMode: record.paginationMode,
    defaultPageSize: Math.floor(record.defaultPageSize),
  };
}

