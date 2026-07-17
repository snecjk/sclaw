/**
 * Build Gateway RPC message text from skill defaultPrompt and optional user input.
 * UI layers MUST NOT use this for bubble display — only for backend send.
 */
export function resolveSkillGatewayText(defaultPrompt: string, userText: string): string {
  const prompt = defaultPrompt.trim();
  const user = userText.trim();
  if (!user) return prompt;
  if (!prompt) return user;
  return `${prompt}\n\n${user}`;
}
