const DWS_CHAT_MESSAGE_SEND = /dws\s+chat\s+message\s+send\b/i;
const DWS_SEND_DRY_RUN = /--dry-run\b/i;
const SHELL_LOOP_KEYWORD = /\b(?:for|while|until|seq|xargs)\b/i;

const COMMAND_PARAM_KEYS = [
  'command',
  'cmd',
  'script',
  'input',
  'argv',
  'args',
  'program',
  'line',
  'shellCommand',
  'shell_command',
  'arguments',
  'request',
] as const;

export const DINGTALK_SEND_MIN_INTERVAL_MS = 60_000;

export type DingTalkSendGuardDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function fromArgvLike(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parts = value
    .map((item) => (typeof item === 'string' ? item.trim() : item != null ? String(item).trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function collectCommandStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCommandStrings(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  for (const key of COMMAND_PARAM_KEYS) {
    const nested = record[key];
    if (nested != null) collectCommandStrings(nested, out);
  }
}

/** Extract shell / exec command text from a tool call payload. */
export function extractToolCommandText(
  toolName: string,
  params: Record<string, unknown> | undefined,
): string {
  const chunks: string[] = [];
  if (params) collectCommandStrings(params, chunks);

  if (chunks.length === 0) {
    try {
      const serialized = JSON.stringify(params ?? {});
      if (serialized && serialized !== '{}') chunks.push(serialized);
    } catch {
      // ignore
    }
  }

  const name = toolName.trim().toLowerCase();
  if (chunks.length === 0 && (name === 'exec' || name === 'bash' || name === 'shell')) {
    return '';
  }

  return chunks.join('\n');
}

export function containsDwsChatMessageSend(commandText: string): boolean {
  return DWS_CHAT_MESSAGE_SEND.test(commandText);
}

export function isDwsChatMessageSendDryRun(commandText: string): boolean {
  return DWS_SEND_DRY_RUN.test(commandText);
}

export function countDwsChatMessageSendCalls(commandText: string): number {
  return commandText.match(/dws\s+chat\s+message\s+send\b/gi)?.length ?? 0;
}

/** Detect loop / batch dws send patterns inside one shell command. */
export function isBatchDwsChatMessageSend(commandText: string): boolean {
  if (!containsDwsChatMessageSend(commandText)) return false;
  if (countDwsChatMessageSendCalls(commandText) > 1) return true;
  if (SHELL_LOOP_KEYWORD.test(commandText)) return true;
  return false;
}

const lastSendAtByScope = new Map<string, number>();

export function resetDingTalkSendRateLimitForTests(): void {
  lastSendAtByScope.clear();
}

function resolveRateLimitScope(sessionKey?: string): string {
  const key = sessionKey?.trim();
  return key || '__global__';
}

export function checkDingTalkSendRateLimit(
  sessionKey: string | undefined,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const scope = resolveRateLimitScope(sessionKey);
  const last = lastSendAtByScope.get(scope);
  if (last != null && now - last < DINGTALK_SEND_MIN_INTERVAL_MS) {
    return {
      allowed: false,
      retryAfterMs: DINGTALK_SEND_MIN_INTERVAL_MS - (now - last),
    };
  }
  return { allowed: true };
}

export function recordDingTalkSendAllowed(sessionKey: string | undefined, now = Date.now()): void {
  lastSendAtByScope.set(resolveRateLimitScope(sessionKey), now);
}

export function evaluateDingTalkSendGuard(input: {
  toolName: string;
  params?: Record<string, unknown>;
  sessionKey?: string;
  now?: number;
}): DingTalkSendGuardDecision {
  const commandText = extractToolCommandText(input.toolName, input.params);
  if (!containsDwsChatMessageSend(commandText)) {
    return { allowed: true };
  }

  if (isBatchDwsChatMessageSend(commandText)) {
    return {
      allowed: false,
      reason:
        '[StoClaw 安全策略] 禁止通过循环或批量命令多次调用 dws chat message send。请一次只发送一条消息。',
    };
  }

  if (isDwsChatMessageSendDryRun(commandText)) {
    return { allowed: true };
  }

  const rate = checkDingTalkSendRateLimit(input.sessionKey, input.now);
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return {
      allowed: false,
      reason: `[StoClaw 安全策略] 钉钉消息发送过于频繁，请 ${seconds} 秒后再试（每分钟最多 1 条）。`,
    };
  }

  recordDingTalkSendAllowed(input.sessionKey, input.now);
  return { allowed: true };
}

/** Gateway child_process preload — keep in sync with evaluateDingTalkSendGuard batch rules. */
export function isBlockedDwsSendSpamCommand(commandLine: string): boolean {
  const text = commandLine.trim();
  if (!containsDwsChatMessageSend(text)) return false;
  if (isDwsChatMessageSendDryRun(text)) return false;
  return isBatchDwsChatMessageSend(text);
}
