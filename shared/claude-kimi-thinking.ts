/**
 * k3 在 Claude Agent SDK 的 thinking 块里会把计划冻住，不读刚返回的 tool_result。
 * 对 Kimi 关掉 extended thinking，让下一 token 直接看工具结果。
 */
export function isKimiModel(model: string | undefined): boolean {
  if (!model) return false;
  return /kimi/i.test(model);
}

export function claudeThinkingConfigForModel(model: string | undefined): { type: 'disabled' } | undefined {
  return isKimiModel(model) ? { type: 'disabled' } : undefined;
}
