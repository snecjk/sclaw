/** OpenClaw sessions created only for workflow smart-node execution. */
export const WORKFLOW_OPENCLAW_SESSION_PREFIX = 'agent:workflow-runtime:workflow:';

export function isWorkflowOpenClawSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(WORKFLOW_OPENCLAW_SESSION_PREFIX);
}
