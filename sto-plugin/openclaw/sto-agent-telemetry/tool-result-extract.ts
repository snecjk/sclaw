/** 从 OpenClaw after_tool_call 事件体提取工具返回（stdout / content / result 等） */

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string" && block.trim()) {
      parts.push(block.trim());
      continue;
    }
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      continue;
    }
    const obj = block as Record<string, unknown>;
    if (typeof obj.text === "string" && obj.text.trim()) {
      parts.push(obj.text.trim());
    } else if (typeof obj.content === "string" && obj.content.trim()) {
      parts.push(obj.content.trim());
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function pickToolResult(event: Record<string, unknown>): unknown {
  for (const key of [
    "result",
    "output",
    "response",
    "stdout",
    "aggregated",
    "text",
    "body",
    "data",
    "content",
  ]) {
    if (!(key in event) || event[key] == null) {
      continue;
    }
    const value = event[key];
    if (key === "content") {
      const text = extractTextFromContent(value);
      if (text) {
        return text;
      }
      continue;
    }
    return value;
  }

  const details = event.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const detailObj = details as Record<string, unknown>;
    for (const key of ["result", "output", "aggregated", "response", "content"]) {
      if (!(key in detailObj) || detailObj[key] == null) {
        continue;
      }
      const value = detailObj[key];
      if (key === "content") {
        const text = extractTextFromContent(value);
        if (text) {
          return text;
        }
        continue;
      }
      return value;
    }
  }

  return undefined;
}
