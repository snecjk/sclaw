/** Engine-neutral execution snapshot contract and safe parsing helpers. */

export type ToolStatus = 'completed' | 'error' | 'unknown';

export type ToolError = {
  code?: string;
  message?: string;
};

export type Tool = {
  toolCallId?: string;
  name: string;
  status: ToolStatus;
  /** The executable command supplied to the tool call. */
  command?: string;
  /** Human-readable purpose supplied with the tool call. */
  description?: string;
  /** Additional call arguments not already lifted to command/description. */
  input?: Record<string, unknown>;
  /** Sanitized diagnostic metadata, emitted only for failed calls. */
  error?: ToolError;
};

export type ExecutionSnapshot = {
  userMessage: string;
  assistantMessage: string;
  tools: Tool[];
  /** Total source message count, for diagnostics. */
  messageCount: number;
};

export type ExecutionTurn = {
  userIndex: number;
  assistantIndex: number;
  userMessage: string;
  assistantMessage: string;
};

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const record = asRecord(block);
      return record && typeof record.text === 'string' ? record.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function messageText(message: Record<string, unknown>): string {
  return contentText(message.content);
}

/** Select the latest completed text turn from normalized engine messages. */
export function selectExecutionTurn(messages: Record<string, unknown>[]): ExecutionTurn | null {
  let assistantIndex = messages.length - 1;
  while (assistantIndex >= 0) {
    const message = messages[assistantIndex];
    if (String(message.role).toLowerCase() === 'assistant' && messageText(message)) break;
    assistantIndex -= 1;
  }
  if (assistantIndex < 0) return null;

  let userIndex = assistantIndex - 1;
  while (userIndex >= 0) {
    const message = messages[userIndex];
    if (String(message.role).toLowerCase() === 'user' && messageText(message)) break;
    userIndex -= 1;
  }
  if (userIndex < 0) return null;

  return {
    userIndex,
    assistantIndex,
    userMessage: messageText(messages[userIndex]),
    assistantMessage: messageText(messages[assistantIndex]),
  };
}

export function extractCommandFromArgs(args?: Record<string, unknown>): string | undefined {
  if (!args) return undefined;
  const direct = asTrimmedString(args.command)
    ?? asTrimmedString(args.cmd)
    ?? asTrimmedString(args.script)
    ?? asTrimmedString(args.line);
  if (direct) return direct;

  const nestedInput = asRecord(args.input);
  const nested = nestedInput
    ? asTrimmedString(nestedInput.command) ?? asTrimmedString(nestedInput.cmd)
    : undefined;
  if (nested) return nested;

  const argv = args.argv ?? args.args;
  if (!Array.isArray(argv)) return undefined;
  const command = argv
    .map((item) => item == null ? '' : String(item).trim())
    .filter(Boolean)
    .join(' ');
  return command || undefined;
}

/** Remove call arguments already represented by normalized top-level fields. */
export function compactToolInput(
  args: Record<string, unknown> | undefined,
  lifted: { command?: string; description?: string },
): Record<string, unknown> | undefined {
  if (!args) return undefined;
  const compacted = { ...args };

  for (const key of ['command', 'cmd', 'script', 'line']) {
    if (lifted.command && asTrimmedString(compacted[key]) === lifted.command) delete compacted[key];
  }
  if (lifted.description && asTrimmedString(compacted.description) === lifted.description) {
    delete compacted.description;
  }

  const nestedInput = asRecord(compacted.input);
  if (nestedInput) {
    const compactedNested = { ...nestedInput };
    for (const key of ['command', 'cmd']) {
      if (lifted.command && asTrimmedString(compactedNested[key]) === lifted.command) delete compactedNested[key];
    }
    if (Object.keys(compactedNested).length > 0) compacted.input = compactedNested;
    else delete compacted.input;
  }

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return asRecord(value);
}

export function resultIndicatesFailure(value: unknown): boolean {
  const record = parseJsonRecord(value);
  if (!record) return false;
  if (record.ok === false || record.success === false) return true;
  const data = asRecord(record.data);
  if (data && (data.ok === false || data.success === false)) return true;
  return Boolean(record.error && record.error !== false);
}

export function sanitizeToolErrorText(value: unknown): string | undefined {
  const text = asTrimmedString(value);
  if (!text) return undefined;
  return text
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

export function extractToolError(value: unknown): ToolError | undefined {
  const record = parseJsonRecord(value);
  if (!record) {
    const message = sanitizeToolErrorText(value);
    return message ? { message } : undefined;
  }

  const nestedError = asRecord(record.error);
  const data = asRecord(record.data);
  const rawCode = asTrimmedString(record.errorCode)
    ?? asTrimmedString(record.code)
    ?? asTrimmedString(nestedError?.code)
    ?? asTrimmedString(data?.errorCode)
    ?? asTrimmedString(data?.code);
  const code = rawCode?.slice(0, 80);
  const message = sanitizeToolErrorText(record.errorMessage)
    ?? sanitizeToolErrorText(record.message)
    ?? sanitizeToolErrorText(typeof record.error === 'string' ? record.error : undefined)
    ?? sanitizeToolErrorText(nestedError?.message)
    ?? sanitizeToolErrorText(data?.errorMessage)
    ?? sanitizeToolErrorText(data?.message);
  return code || message ? { ...(code ? { code } : {}), ...(message ? { message } : {}) } : undefined;
}
