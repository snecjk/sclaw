/** Request body shared by the Claude workflow MCP tool and its contract test. */
export function buildClaudeWorkflowStartBody(
  inputs: Record<string, unknown>,
  idempotencyKey: string,
  sessionKey: string,
  templateName?: string,
): string {
  return JSON.stringify({
    inputs,
    idempotencyKey,
    sessionKey,
    chatCardTitle: templateName,
    chatParamsSummary: Object.keys(inputs).length ? JSON.stringify(inputs) : undefined,
    engineType: 'claude',
  });
}
