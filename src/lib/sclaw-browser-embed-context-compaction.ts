/** Long-running embed app chat — context pressure hints (Gateway compaction still applies globally). */

export const EMBED_CHAT_LONG_SESSION_MESSAGE_THRESHOLD = 40;

export function buildEmbedSessionLongContextNotice(messageCount: number): string | null {
  if (messageCount < EMBED_CHAT_LONG_SESSION_MESSAGE_THRESHOLD) return null;
  return [
    '【长会话提示】此应用对话历史较长，较早上下文可能已被 Gateway 自动压缩。',
    '请优先依据下方最新页面快照与最近几轮对话作答；历史 tool 输出可能已是摘要。',
  ].join('');
}
