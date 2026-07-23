import {
  asRecord,
  asTrimmedString,
  compactToolInput,
  contentText,
  extractCommandFromArgs,
  extractToolError,
  parseJsonRecord,
  resultIndicatesFailure,
  selectExecutionTurn,
  type ExecutionSnapshot,
  type Tool,
  type ToolStatus,
} from './execution-snapshot';

function normalizeKind(value: unknown): string {
  return String(value ?? '').replace(/[-_]/g, '').toLowerCase();
}

function extractPathCommand(value: unknown): string | undefined {
  const path = asTrimmedString(value);
  if (!path) return undefined;
  const segments = path.split(/[/\s.]+/).filter(Boolean);
  return segments.length >= 3 ? segments.slice(0, 3).join(' ') : undefined;
}

function extractCommandFromResult(value: unknown): string | undefined {
  const record = parseJsonRecord(value);
  if (!record) return undefined;
  const data = asRecord(record.data);
  const nestedInput = asRecord(data?.input);
  return extractPathCommand(data?.path)
    ?? extractPathCommand(nestedInput?.path)
    ?? extractPathCommand(record.path);
}

function inferToolName(rawName: string, command?: string): string {
  if ((rawName !== 'exec' && rawName !== 'unknown_tool') || !command) return rawName;
  return command.split(/\s+/).slice(0, 3).join('.');
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return asRecord(value);
}

function resultStatus(input: {
  result: unknown;
  hasResult: boolean;
  explicitError?: boolean;
  explicitStatus?: unknown;
}): ToolStatus {
  const status = String(input.explicitStatus ?? '').toLowerCase();
  if (input.explicitError === true || status === 'error' || status === 'failed' || resultIndicatesFailure(input.result)) {
    return 'error';
  }
  if (input.hasResult || status === 'completed' || status === 'success' || status === 'succeeded') return 'completed';
  return 'unknown';
}

function mergeCall(previous: Tool | undefined, id: unknown, rawName: unknown, args?: Record<string, unknown>): Tool {
  const command = extractCommandFromArgs(args) ?? previous?.command;
  const description = asTrimmedString(args?.description) ?? previous?.description;
  const input = args ? compactToolInput(args, { command, description }) : previous?.input;
  const name = inferToolName(String(rawName ?? previous?.name ?? 'unknown_tool'), command);
  const merged: Tool = {
    ...previous,
    toolCallId: typeof id === 'string' ? id : previous?.toolCallId,
    name,
    status: previous?.status ?? 'unknown',
    command,
    description,
  };
  if (input) merged.input = input;
  else delete merged.input;
  return merged;
}

function mergeResult(previous: Tool | undefined, input: {
  id: unknown;
  name?: unknown;
  result: unknown;
  hasResult: boolean;
  explicitError?: boolean;
  explicitStatus?: unknown;
}): Tool {
  const status = resultStatus(input);
  const command = previous?.command ?? extractCommandFromResult(input.result);
  const rawName = String(input.name ?? previous?.name ?? 'unknown_tool');
  const error = status === 'error' ? extractToolError(input.result) : undefined;
  return {
    ...previous,
    toolCallId: typeof input.id === 'string' ? input.id : previous?.toolCallId,
    name: inferToolName(rawName, command),
    status,
    command,
    ...(error ? { error } : { error: undefined }),
  };
}

export function parseOpenClawExecutionTurn(messages: Record<string, unknown>[]): ExecutionSnapshot | null {
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
      const kind = normalizeKind(record.type);
      if (kind === 'toolcall') {
        const key = keyFor(record.id);
        const args = parseArguments(record.arguments ?? record.input);
        tools.set(key, mergeCall(tools.get(key), record.id, record.name ?? record.toolName, args));
      } else if (kind === 'toolresult' || kind === 'toolcallresult') {
        const id = record.tool_use_id ?? record.toolUseId ?? record.toolCallId ?? record.id;
        const key = keyFor(id);
        const result = record.content ?? record.result;
        tools.set(key, mergeResult(tools.get(key), {
          id,
          name: record.name ?? record.toolName,
          result,
          hasResult: result !== undefined,
          explicitError: record.is_error === true || record.isError === true,
          explicitStatus: record.status,
        }));
      }
    }

    const messageToolCalls = message.tool_calls ?? message.toolCalls;
    if (Array.isArray(messageToolCalls)) {
      for (const item of messageToolCalls) {
        const toolCall = asRecord(item);
        if (!toolCall) continue;
        const fn = asRecord(toolCall.function) ?? toolCall;
        const id = toolCall.id;
        const key = keyFor(id);
        const args = parseArguments(fn.arguments ?? fn.input);
        let merged = mergeCall(tools.get(key), id, fn.name ?? toolCall.name, args);
        const hasResult = Object.hasOwn(toolCall, 'result') || Object.hasOwn(fn, 'result');
        const explicitStatus = toolCall.status ?? fn.status;
        if (hasResult || explicitStatus !== undefined) {
          const result = toolCall.result ?? fn.result;
          merged = mergeResult(merged, {
            id,
            name: fn.name ?? toolCall.name,
            result,
            hasResult,
            explicitError: toolCall.isError === true || fn.isError === true,
            explicitStatus,
          });
        }
        tools.set(key, merged);
      }
    }

    const role = normalizeKind(message.role);
    if (role === 'tool' || role === 'toolresult') {
      const id = message.toolCallId ?? message.tool_call_id ?? message.id;
      const key = keyFor(id);
      const result = contentText(message.content) || message.result;
      tools.set(key, mergeResult(tools.get(key), {
        id,
        name: message.toolName ?? message.name,
        result,
        hasResult: result !== undefined && result !== '',
        explicitError: message.isError === true || message.is_error === true,
        explicitStatus: message.status,
      }));
    }
  }

  return {
    userMessage: turn.userMessage,
    assistantMessage: turn.assistantMessage,
    tools: [...tools.values()],
    messageCount: messages.length,
  };
}
