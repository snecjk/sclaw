/** PI sessions created only for isolated workflow smart-node execution. */
export const WORKFLOW_PI_SESSION_PREFIX = 'pi:workflow:';

export function workflowPiSessionKey(nodeSessionId: string): string {
  return `${WORKFLOW_PI_SESSION_PREFIX}${nodeSessionId}`;
}

export function isWorkflowPiSessionKey(sessionKey: string): boolean {
  return sessionKey.startsWith(WORKFLOW_PI_SESSION_PREFIX);
}
