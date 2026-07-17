/**
 * 移除仅供 Agent 使用、绝不能回显给用户的记忆提示块。
 * OpenClaw 会将发送给模型的完整 prompt 写回历史，所有展示入口必须经此函数处理。
 */
export const AGENT_MEMORY_CONTEXT_MARKER = '<!-- StoClaw-Agent-Memory -->';
export const AGENT_EXECUTION_MEMORY_CONTEXT_MARKER = '<!-- StoClaw-Agent-Execution-Memory -->';

export function stripAgentMemoryContextByMarker(message: string, marker: string): string {
  const startIdx = message.indexOf(marker);
  if (startIdx < 0) {
    return message;
  }

  const endIdx = message.lastIndexOf(marker);
  if (endIdx > startIdx) {
    return [
      message.slice(0, startIdx).trim(),
      message.slice(endIdx + marker.length).trim(),
    ].filter(Boolean).join('\n\n');
  }
  return message.slice(0, startIdx).trim();
}

export function stripAgentMemoryContextsForDisplay(message: string): string {
  return stripAgentMemoryContextByMarker(
    stripAgentMemoryContextByMarker(message, AGENT_EXECUTION_MEMORY_CONTEXT_MARKER),
    AGENT_MEMORY_CONTEXT_MARKER,
  );
}
