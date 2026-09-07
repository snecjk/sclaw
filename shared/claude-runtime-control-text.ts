/** Claude Agent SDK transcript control lines — not user-facing replies. */
export function isClaudeRuntimeControlText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^No response requested\.?$/i.test(trimmed)) return true;
  if (/^\[Request interrupted by user for tool use\]$/i.test(trimmed)) return true;
  if (/^<local-command-caveat>[\s\S]*<\/local-command-caveat>$/i.test(trimmed)) return true;
  if (/^<command-name>[\s\S]*<\/command-name>(?:[\s\S]*<command-message>[\s\S]*<\/command-message>)?(?:[\s\S]*<command-args>[\s\S]*<\/command-args>)?$/i.test(trimmed)) return true;
  if (/^<local-command-(?:stdout|stderr)>[\s\S]*<\/local-command-(?:stdout|stderr)>$/i.test(trimmed)) return true;
  if (trimmed.startsWith('This session is being continued from a previous conversation that ran out of context.')) return true;
  return false;
}
