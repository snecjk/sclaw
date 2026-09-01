/** Claude Agent SDK transcript control lines — not user-facing replies. */
export function isClaudeRuntimeControlText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^No response requested\.?$/i.test(trimmed)) return true;
  if (/^\[Request interrupted by user for tool use\]$/i.test(trimmed)) return true;
  return false;
}
