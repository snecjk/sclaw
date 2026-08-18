/**
 * 将 systemPromptAppend 前置合并进 user message。
 * OpenClaw（Gateway 不接受 append）与 Claude 定时任务（提高钉钉必发可见性）共用。
 */
export function prependSystemPromptAppend(
  message: string,
  systemPromptAppend?: string | null,
): string {
  const append = systemPromptAppend?.trim();
  if (!append) return message;
  const body = message.trim();
  if (!body) return append;
  return `${append}\n\n${body}`;
}

/**
 * 定时任务专用：把必须进入 user message 的系统上下文与真实任务正文用稳定边界隔开。
 * OpenClaw 的 chat.send 不接受 systemPromptAppend，因此需要把上下文写进 message；
 * 该边界同时让聊天历史展示可以只还原真实任务正文。
 */
export function wrapScheduledTaskSystemPromptAppend(
  message: string,
  systemPromptAppend?: string | null,
): string {
  const append = systemPromptAppend?.trim();
  if (!append) return message;
  const body = message.trim();
  if (!body) return append;
  return `${append}\n\n---\n\n用户消息：\n${body}`;
}
