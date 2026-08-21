/** Workflow smart-node timeout defaults shared by the designer and executors. */
export const WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS = 10 * 60 * 1000;
export const WORKFLOW_AGENT_HARD_DEADLINE_MS = 30 * 60 * 1000;

/**
 * Older published workflows persisted the former 5-minute default in their DSL.
 * Treat that value as a legacy default so existing workflows receive the new
 * timeout policy without requiring users to republish every definition.
 */
export const LEGACY_WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS = 5 * 60 * 1000;

export function resolveWorkflowAgentNoProgressMs(configuredMs?: number): number {
  if (
    typeof configuredMs !== 'number'
    || !Number.isFinite(configuredMs)
    || configuredMs <= 0
    || configuredMs === LEGACY_WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS
  ) {
    return WORKFLOW_AGENT_NO_PROGRESS_TIMEOUT_MS;
  }
  return configuredMs;
}

export function resolveWorkflowAgentDeadlineMs(): number {
  return WORKFLOW_AGENT_HARD_DEADLINE_MS;
}
