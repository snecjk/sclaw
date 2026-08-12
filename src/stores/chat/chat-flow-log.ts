export function logChatFlow(stage: string, data?: Record<string, unknown>): void {
  console.info('[chat-flow]', stage, data ?? {});
}

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
  console.info(USER_QUESTION_LOG_PREFIX, stage, data ?? {});
}

/** 类型收窄版：专门打 `server-echo`，字段含义见 {@link UserQuestionServerEchoLog} */
export function logUserQuestionServerEcho(data: UserQuestionServerEchoLog): void {
  logUserQuestion('server-echo', data as unknown as Record<string, unknown>);
}
