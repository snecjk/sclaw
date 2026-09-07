/** Claude Agent SDK transcript control lines — not user-facing replies. */
export function isClaudeRuntimeControlText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^No response requested\.?$/i.test(trimmed)) return true;
  if (/^\[Request interrupted by user for tool use\]$/i.test(trimmed)) return true;
  return false;
}

/** User asks to continue after a hung / interrupted turn. */
export function isContinueUserPrompt(text: string | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^(继续|接着|go on|continue|resume)([。.!！]?)$/i.test(trimmed)) return true;
  return /^(请)?继续(吧|啊|分析|写)?[。.!！]?$/.test(trimmed);
}

/**
 * Resume starts a new SDK query. Transcript tool_result lines are not empty user
 * turns — tell the model to write from existing tools instead of re-probing.
 */
export function buildClaudeResumeInterruptAppend(input: {
  isResume: boolean;
  isContinue: boolean;
  lastError?: string;
}): string | undefined {
  if (!input.isResume) return undefined;
  if (!input.isContinue && !input.lastError) return undefined;
  const lines = [
    '【上一轮中断或用户要求继续】resume 会开新的 SDK query；历史里的 tool_result 是 transcript 行，不是空的用户消息。',
    '根据已有 snapshot/正文/点击结果直接写结论或执行下一步；禁止再 list_sessions / ba_create_session / 空转「检查会话」。',
  ];
  if (input.lastError) {
    lines.push(`上一轮中断原因：${input.lastError}`);
  }
  return lines.join('\n');
}
