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
