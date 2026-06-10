const DWS_CHAT_MESSAGE_SEND = /dws\s+chat\s+message\s+send\b/i;
const DWS_SEND_DRY_RUN = /--dry-run\b/i;
const SHELL_LOOP_KEYWORD = /\b(?:for|while|until|seq|xargs)\b/i;
const DWS_SEND_MEDIA_MSG_TYPE = /--msg-type\s+(?:image|file)\b/i;
const DWS_SEND_MEDIA_FLAG = /(?:--media-id\b|\s--file\s)/i;

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

export const DINGTALK_SEND_MIN_INTERVAL_MS = 20_000;

export type DingTalkSendRateLimitCategory = 'text' | 'image';

export type DingTalkSendGuardDecision =
  | { allowed: true; category?: DingTalkSendRateLimitCategory }
  | { allowed: false; reason: string };

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

/** Text vs image/file sends use separate per-minute buckets. */
export function classifyDwsChatMessageSendCategory(
  commandText: string,
): DingTalkSendRateLimitCategory | null {
  if (!containsDwsChatMessageSend(commandText) || isDwsChatMessageSendDryRun(commandText)) {
    return null;
  }
  if (DWS_SEND_MEDIA_MSG_TYPE.test(commandText) || DWS_SEND_MEDIA_FLAG.test(commandText)) {
    return 'image';
  }
  return 'text';
}

/** Detect loop / batch dws send patterns inside one shell command. */
export function isBatchDwsChatMessageSend(commandText: string): boolean {
  if (!containsDwsChatMessageSend(commandText)) return false;
  if (countDwsChatMessageSendCalls(commandText) > 1) return true;
  if (SHELL_LOOP_KEYWORD.test(commandText)) return true;
  return false;
}

const lastSuccessAtByScope = new Map<string, number>();
const pendingSendByToolCallId = new Map<
  string,
  { sessionKey: string; category: DingTalkSendRateLimitCategory }
>();

export function resetDingTalkSendRateLimitForTests(): void {
  lastSuccessAtByScope.clear();
  pendingSendByToolCallId.clear();
}

function resolveRateLimitScope(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
): string {
  const key = sessionKey?.trim() || '__global__';
  return `${key}:${category}`;
}

function categoryLabel(category: DingTalkSendRateLimitCategory): string {
  return category === 'text' ? '文字' : '图片';
}

export function checkDingTalkSendRateLimit(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  const scope = resolveRateLimitScope(sessionKey, category);
  const last = lastSuccessAtByScope.get(scope);
  if (last != null && now - last < DINGTALK_SEND_MIN_INTERVAL_MS) {
    return {
      allowed: false,
      retryAfterMs: DINGTALK_SEND_MIN_INTERVAL_MS - (now - last),
    };
  }
  return { allowed: true };
}

export function recordDingTalkSendSuccess(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
  now = Date.now(),
): void {
  lastSuccessAtByScope.set(resolveRateLimitScope(sessionKey, category), now);
}

export function rememberPendingDingTalkSend(
  toolCallId: string | undefined,
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
): void {
  const id = toolCallId?.trim();
  if (!id) return;
  pendingSendByToolCallId.set(id, {
    sessionKey: sessionKey?.trim() || '__global__',
    category,
  });
}

export function clearPendingDingTalkSend(toolCallId: string | undefined): void {
  const id = toolCallId?.trim();
  if (!id) return;
  pendingSendByToolCallId.delete(id);
}

function extractResultText(result: unknown): string {
  if (typeof result === 'string') return result.trim();
  if (!result || typeof result !== 'object') return '';
  const record = result as Record<string, unknown>;
  for (const key of ['stdout', 'output', 'text', 'aggregated', 'content', 'result', 'body']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/** True only when dws send clearly succeeded (used for post-success rate counting). */
export function isSuccessfulDwsChatMessageSendResult(error: unknown, result: unknown): boolean {
  if (error != null && error !== false && String(error).trim()) return false;

  const text = extractResultText(result);
  if (!text) return false;

  if (/"ok"\s*:\s*false/i.test(text)) return false;
  if (/\bok\s*[:=]\s*false/i.test(text)) return false;
  if (/error|failed|失败|错误/i.test(text) && !/"ok"\s*:\s*true/i.test(text)) {
    return false;
  }

  return (
    /"ok"\s*:\s*true/i.test(text)
    || /\bsuccess(?:ful)?\b/i.test(text)
    || /发送成功|已发送/i.test(text)
    || /openTaskId|processQueryKey/i.test(text)
  );
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

  const category = classifyDwsChatMessageSendCategory(commandText);
  if (!category) {
    return { allowed: true };
  }

  const rate = checkDingTalkSendRateLimit(input.sessionKey, category, input.now);
  if (!rate.allowed) {
    const seconds = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
    return {
      allowed: false,
      reason: `[StoClaw 安全策略] 钉钉${categoryLabel(category)}消息发送过于频繁，请 ${seconds} 秒后再试（每 20 秒最多 1 条${categoryLabel(category)}消息）。`,
    };
  }

  return { allowed: true, category };
}

export function handleDingTalkSendGuardAfter(input: {
  toolName: string;
  params?: Record<string, unknown>;
  sessionKey?: string;
  toolCallId?: string;
  error?: unknown;
  result?: unknown;
  now?: number;
}): void {
  const toolCallId = input.toolCallId?.trim();
  const pending = toolCallId ? pendingSendByToolCallId.get(toolCallId) : undefined;
  if (toolCallId) pendingSendByToolCallId.delete(toolCallId);

  const commandText = extractToolCommandText(input.toolName, input.params);
  if (!containsDwsChatMessageSend(commandText) || isDwsChatMessageSendDryRun(commandText)) {
    return;
  }

  if (!isSuccessfulDwsChatMessageSendResult(input.error, input.result)) {
    return;
  }

  const category =
    pending?.category ?? classifyDwsChatMessageSendCategory(commandText) ?? 'text';
  const sessionKey = pending?.sessionKey ?? input.sessionKey;
  recordDingTalkSendSuccess(sessionKey, category, input.now);
}

/** Gateway child_process preload — keep in sync with evaluateDingTalkSendGuard batch rules. */
export function isBlockedDwsSendSpamCommand(commandLine: string): boolean {
  const text = commandLine.trim();
  if (!containsDwsChatMessageSend(text)) return false;
  if (isDwsChatMessageSendDryRun(text)) return false;
  return isBatchDwsChatMessageSend(text);
}
