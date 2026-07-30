/** Request body shared by the Claude workflow MCP tool and its contract test. */
export function buildClaudeWorkflowStartBody(
  inputs: Record<string, unknown>,
  idempotencyKey: string,
  sessionKey: string,
): string {
  return JSON.stringify({
    inputs,
    idempotencyKey,
    sessionKey,
    engineType: 'claude',
  });
}
