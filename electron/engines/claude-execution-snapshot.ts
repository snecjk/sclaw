import {
  asRecord,
  asTrimmedString,
  compactToolInput,
  contentText,
  extractCommandFromArgs,
  extractToolError,
  resultIndicatesFailure,
  selectExecutionTurn,
  type ExecutionSnapshot,
  type Tool,
} from './execution-snapshot';

export type ClaudeExecutionEntryBatch = {
  sessionId: string;
  entries: Record<string, unknown>[];
};

function entryTimestamp(entry: Record<string, unknown>): number {
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) return entry.timestamp;
  if (typeof entry.timestamp !== 'string') return 0;
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeClaudeExecutionEntries(
  batches: ClaudeExecutionEntryBatch[],
  limit: number,
): Record<string, unknown>[] {
  const entriesById = new Map<string, Record<string, unknown>>();
  for (const batch of batches) {
    for (const [index, entry] of batch.entries.entries()) {
      const id = typeof entry.uuid === 'string' && entry.uuid
        ? entry.uuid
        : `${batch.sessionId}:${index}`;
      if (!entriesById.has(id)) entriesById.set(id, entry);
    }
  }
  return [...entriesById.values()]
    .sort((left, right) => entryTimestamp(left) - entryTimestamp(right))
    .slice(-Math.max(1, limit));
}

function normalizeClaudeMessages(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.map((entry) => {
    const payload = asRecord(entry.message) ?? entry;
    return {
      role: payload.role ?? entry.type,
      content: payload.content,
      timestamp: entry.timestamp,
    };
  });
}

function resultFailed(block: Record<string, unknown>, result: unknown): boolean {
  return block.is_error === true || block.isError === true || resultIndicatesFailure(result);
}

export function parseClaudeExecutionTurn(entries: Record<string, unknown>[]): ExecutionSnapshot | null {
  const messages = normalizeClaudeMessages(entries);
  const turn = selectExecutionTurn(messages);
  if (!turn) return null;

  const tools = new Map<string, Tool>();
  let serial = 0;
  const keyFor = (id: unknown): string => typeof id === 'string' && id ? id : `unknown-${serial++}`;

  for (const message of messages.slice(turn.userIndex + 1, turn.assistantIndex + 1)) {
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      const record = asRecord(block);
      if (!record) continue;
      if (record.type === 'tool_use') {
        const id = record.id;
        const key = keyFor(id);
        const previous = tools.get(key);
        const args = asRecord(record.input);
        const command = extractCommandFromArgs(args) ?? previous?.command;
        const description = asTrimmedString(args?.description) ?? previous?.description;
        const input = args ? compactToolInput(args, { command, description }) : previous?.input;
        const merged: Tool = {
          ...previous,
          toolCallId: typeof id === 'string' ? id : previous?.toolCallId,
          name: String(record.name ?? previous?.name ?? 'unknown_tool'),
          status: previous?.status ?? 'unknown',
          command,
          description,
        };
        if (input) merged.input = input;
        else delete merged.input;
        tools.set(key, merged);
      } else if (record.type === 'tool_result') {
        const id = record.tool_use_id ?? record.toolUseId;
        const key = keyFor(id);
        const previous = tools.get(key);
        const result = typeof record.content === 'string' ? record.content : contentText(record.content);
        const failed = resultFailed(record, result);
        const error = failed ? extractToolError(result) : undefined;
        tools.set(key, {
          ...previous,
          toolCallId: typeof id === 'string' ? id : previous?.toolCallId,
          name: String(record.name ?? previous?.name ?? 'unknown_tool'),
          status: failed ? 'error' : 'completed',
          ...(error ? { error } : { error: undefined }),
        });
      }
    }
  }

  return {
    userMessage: turn.userMessage,
    assistantMessage: turn.assistantMessage,
    tools: [...tools.values()],
    messageCount: entries.length,
  };
}
