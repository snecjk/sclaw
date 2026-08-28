/** 真正发给模型的载荷日志前缀——搜索：`[USER-SEND]`（主进程终端） */
export const USER_SEND_LOG_PREFIX = '[USER-SEND]';

export interface UserSendLogPayload {
  engine: 'openclaw' | 'claude';
  sessionKey: string;
  /** 最终进入模型侧的 user message 正文（经 memory / systemPromptAppend / media 拼结后） */
  message: string;
  messageLength: number;
  /** Claude 等走独立 system 通道时附带；OpenClaw 通常已并进 message */
  systemPromptAppend?: string | null;
  systemPromptAppendLength?: number;
  idempotencyKey?: string;
  attachmentCount?: number;
}

/** 主进程：在 adapter 即将 RPC / 启动 query 前打印最终载荷 */
export function logUserSend(data: UserSendLogPayload): void {
  // console.info(USER_SEND_LOG_PREFIX, {
  //   engine: data.engine,
  //   sessionKey: data.sessionKey,
  //   /** Agent 发给模型的 user 正文（拼结后） */
  //   agentToModelUserMessage: data.message,
  //   agentToModelUserMessageLength: data.messageLength,
  //   /** Claude：独立 system 通道；OpenClaw：通常已并进 agentToModelUserMessage */
  //   systemPromptAppend: data.systemPromptAppend ?? null,
  //   systemPromptAppendLength: data.systemPromptAppendLength ?? 0,
  //   idempotencyKey: data.idempotencyKey,
  //   attachmentCount: data.attachmentCount ?? 0,
  // });
}
