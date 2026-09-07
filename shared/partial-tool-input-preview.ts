export const DEFAULT_PARTIAL_TOOL_INPUT_PREVIEW_CHARS = 4_096;

/**
 * Bounds an incomplete tool-input fragment while keeping enough context from
 * both ends to make the live preview useful. The caller must retain the full
 * fragment separately for parsing and tool execution.
 */
export function buildPartialToolInputPreview(
  inputJson: string,
  maxChars = DEFAULT_PARTIAL_TOOL_INPUT_PREVIEW_CHARS,
): string {
  if (inputJson.length <= maxChars) return inputJson;
  const marker = `\n… [partial tool input: ${inputJson.length} chars] …\n`;
  const available = Math.max(0, maxChars - marker.length);
  const headLength = Math.ceil(available * 0.75);
  const tailLength = available - headLength;
  const tail = tailLength > 0 ? inputJson.slice(-tailLength) : '';
  return `${inputJson.slice(0, headLength)}${marker}${tail}`;
}
