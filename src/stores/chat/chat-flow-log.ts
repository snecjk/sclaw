/** Enable verbose chat-flow / user-question logs: `localStorage.setItem('sclaw:debug-chat-flow', '1')` */
export const CHAT_FLOW_DEBUG_STORAGE_KEY = 'sclaw:debug-chat-flow';

const LOG_TEXT_MAX_CHARS = 200;

export function isChatFlowDebugEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(CHAT_FLOW_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function truncateText(value: string, maxChars = LOG_TEXT_MAX_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 3)}...`;
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateText(value);
  if (typeof value !== 'object') return value;
  if (depth >= 2) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => sanitizeLogValue(item, depth + 1));
  }
  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'segments' || key === 'optimisticSegments' || key === 'historySegments') {
      sanitized[key] = Array.isArray(entry) ? `[segments:${entry.length}]` : entry;
      continue;
    }
    if (key === 'optimisticAttachments' || key === 'historyAttachments' || key === 'attachments') {
      sanitized[key] = Array.isArray(entry) ? `[attachments:${entry.length}]` : entry;
      continue;
    }
    sanitized[key] = sanitizeLogValue(entry, depth + 1);
  }
  return sanitized;
}

function sanitizeLogData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return sanitizeLogValue(data) as Record<string, unknown>;
}

export function logChatFlow(stage: string, data?: Record<string, unknown>): void {
  if (!isChatFlowDebugEnabled()) return;
  console.info('[chat-flow]', stage, {
    at: new Date().toISOString(),
    ...(sanitizeLogData(data) ?? {}),
  });
}

/**
 * `[USER-SEND]` 由主进程在 adapter 最终出口打印（见 openclaw/claude adapter），
 * 含 memory 注入、systemPromptAppend 合并、`[media attached:]` 等之后的正文。
 * 渲染进程的 `[USER-QUESTION]` 只覆盖气泡/配对，不代表模型最终可见内容。
 */

/** 用户提问调试日志的统一控制台前缀——搜索：`[USER-QUESTION]` */
export const USER_QUESTION_LOG_PREFIX = '[USER-QUESTION]';

/**
 * `[USER-QUESTION] server-echo` 载荷：乐观用户提问与 Gateway history 回显配对成功时打印。
 *
 * 用来排查：双气泡、chip 丢失、编辑重发串轮、终态泄漏 `[文件:]`/`[技能:]` 等。
 * 控制台搜索：`[USER-QUESTION] server-echo`
 */
export interface UserQuestionServerEchoLog {
  /** 当前会话 key（如 `agent:main:session-…`） */
  sessionKey: string | null;

  /**
   * 配对依据：
   * - `id-match`：乐观消息 id 与 history user id 相同（idempotencyKey 回传）
   * - `display-or-time-match`：靠展示文案 / 附件证据 / 发送时间窗配对（id 缺失时常见）
   */
  matchReason: 'id-match' | 'display-or-time-match';

  /**
   * 客户端乐观用户消息 id（发送时 UUID，常兼作 idempotencyKey）。
   * `null` 表示本轮 donor 来自「上一帧投影」而非 overlay 乐观（乐观已被清掉后的二次 history）。
   */
  optimisticId: string | null;

  /**
   * Gateway history 里配对到的 user 消息 id。
   * `null` 表示服务端未回传稳定 id（只能靠文案/时间窗配对）。
   */
  historyUserId: string | null;

  /**
   * 乐观侧（或 previous-display donor）的气泡正文 = displayText。
   * 应无人话外的 gateway bake（无 `[文件:]` / `[技能:]` / workflow exec / 钉钉收件人块）。
   */
  optimisticContent: string | null;

  /**
   * Gateway 落库/回传的 user 原文（常含技能 prompt、`[文件:]`/`[技能:]`、
   * skill marker、`[media attached:]`、钉钉上下文等）。**模型侧看到的接近这份。**
   */
  historyContent: string;

  /** 乐观侧多技能元数据（发送时 `_skillMetas` / `_skillMeta`） */
  optimisticSkillMetas?: Array<{ slug: string; title: string; tagOffset?: number }>;

  /** history 侧已解析到的技能元数据（若有） */
  historySkillMetas?: Array<{ slug: string; title: string; tagOffset?: number }>;

  /**
   * 乐观侧混排权威：text / file / skill / workflow / mention 有序 segments。
   * 气泡与编辑应以此为准；缺失则容易出现 chip 丢失或占位泄漏。
   */
  optimisticSegments?: unknown;

  /** history 原始消息上的 segments（多数时候为空，需靠配对回写补齐） */
  historySegments?: unknown;

  /** 乐观侧附件预览元数据（`_attachedFiles`） */
  optimisticAttachments?: unknown;

  /** history 侧附件（常从 `[media attached:]` 重建） */
  historyAttachments?: unknown;

  /**
   * 配对回写后、准备进投影的 user `content`（应等于乐观 displayText）。
   * 若这里仍是脏 gateway 文案，说明 patch 未生效或串到了别的轮次。
   * （history-apply 的诊断日志可能不带此字段。）
   */
  mergedContent?: string;
}

export function logUserQuestion(stage: string, data?: Record<string, unknown>): void {
  if (!isChatFlowDebugEnabled()) return;
  console.info(USER_QUESTION_LOG_PREFIX, stage, sanitizeLogData(data) ?? {});
}

/** 类型收窄版：专门打 `server-echo`，字段含义见 {@link UserQuestionServerEchoLog} */
export function logUserQuestionServerEcho(data: UserQuestionServerEchoLog): void {
  logUserQuestion('server-echo', data as unknown as Record<string, unknown>);
}
