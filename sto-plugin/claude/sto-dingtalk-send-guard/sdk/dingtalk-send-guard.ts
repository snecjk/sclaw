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

export function isBatchDwsChatMessageSend(commandText: string): boolean {
  if (!containsDwsChatMessageSend(commandText)) return false;
  if (countDwsChatMessageSendCalls(commandText) > 1) return true;
  if (SHELL_LOOP_KEYWORD.test(commandText)) return true;
  return false;
}

const DWS_SEND_FILE_PROTOCOL = /\bfile:\/\//i;

/**
 * 钉钉正文禁止含 `file://` 本地路径（钉钉打不开）。
 * 不豁免 `--dry-run`：file:// 是内容问题，dry-run 预览也应被挡，提示 agent 先上钉盘。
 * 详见 `shared/scheduled-task-instruction.ts` 的【P0 本地产物上钉盘】流程。
 */
export function resolveDwsChatMessageSendFileProtocolInText(commandText: string): string | null {
  if (!containsDwsChatMessageSend(commandText)) return null;
  if (!DWS_SEND_FILE_PROTOCOL.test(commandText)) return null;

  return [
    '[StoClaw 安全策略] 钉钉正文禁止含 `file://` 本地路径（钉钉打不开，定时任务【P0 本地产物上钉盘】已要求先上钉盘）。',
    '请先用 `dws drive upload --file <本地路径（去掉 file:// 前缀）> --space-id <newCSpaceIdIM> -y --format json` 上传钉盘，',
    '从返回 JSON 取 `docUrl`，用「文件名：docUrl」裸 URL 替换正文中的 `file://` 链接后再 `dws chat message send`；',
    '若上传失败则移除该产物链接，只发纯文字总结。',
  ].join('');
}

const lastSuccessAtByScope = new Map<string, number>();
const lastInitiatedAtByScope = new Map<string, number>();
const pendingSendByToolCallId = new Map<
  string,
  { sessionKey: string; category: DingTalkSendRateLimitCategory }
>();

export function resetDingTalkSendRateLimitForTests(): void {
  lastSuccessAtByScope.clear();
  lastInitiatedAtByScope.clear();
  pendingSendByToolCallId.clear();
}

function resolveRateLimitScope(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
): string {
  const key = sessionKey?.trim() || '__global__';
  return `${key}:${category}`;
}

/**
 * 定时任务执行 session key 识别（与 `shared/scheduled-task-instruction.ts`
 * 的 `isScheduledTaskExecutionSessionKey` 保持一致）。定时任务为一次性有意执行，
 * 合法地可能向多名收件人发送，豁免 20s/条限流，避免并集发送被挡。
 */
function isScheduledTaskSessionKey(key: string | undefined): boolean {
  const k = key?.trim();
  if (!k) return false;
  if (k.startsWith('claude-task-run:')) return true;
  if (k.startsWith('scheduled-task:')) return true;
  if (k.startsWith('agent:')) {
    const parts = k.split(':');
    if (parts.length >= 4 && parts[2] === 'cron') return true;
  }
  return /^\[?cron:[^\]]+\]?$/.test(k);
}

function categoryLabel(category: DingTalkSendRateLimitCategory): string {
  return category === 'text' ? '文字' : '图片';
}

export function checkDingTalkSendRateLimit(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
  now = Date.now(),
): { allowed: true } | { allowed: false; retryAfterMs: number } {
  // 定时任务一次性执行，豁免 20s/条限流（支持向多名收件人并集发送）。
  if (isScheduledTaskSessionKey(sessionKey)) return { allowed: true };
  const scope = resolveRateLimitScope(sessionKey, category);
  const lastInitiated = lastInitiatedAtByScope.get(scope);
  const lastSuccess = lastSuccessAtByScope.get(scope);
  const last =
    lastInitiated != null && lastSuccess != null
      ? Math.max(lastInitiated, lastSuccess)
      : lastInitiated ?? lastSuccess;
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

/** 发起即计：放行时立即记录时间戳，失败重试 / 示例+总结双发都会被 20s 窗口挡住。 */
export function recordDingTalkSendInitiate(
  sessionKey: string | undefined,
  category: DingTalkSendRateLimitCategory,
  now = Date.now(),
): void {
  lastInitiatedAtByScope.set(resolveRateLimitScope(sessionKey, category), now);
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

  // file:// 本地路径钉钉打不开，必须先上钉盘；不豁免 --dry-run（内容问题，预览也挡）。
  const fileProtocolProblem = resolveDwsChatMessageSendFileProtocolInText(commandText);
  if (fileProtocolProblem) {
    return {
      allowed: false,
      reason: fileProtocolProblem,
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

  recordDingTalkSendInitiate(input.sessionKey, category, input.now);
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
