import { resolveAvailableClaudeModel } from '../../engines/claude-model-selection';

const CLOUD_MODEL_ALIASES = new Set(['sonnet', 'haiku', 'opus']);

export interface WorkflowExecutionModelSelection {
  accountId: string;
  claudeModel: string;
  /** The exact same model reference is sent to the OpenClaw Gateway. */
  openClawModel: string;
  fallbackApplied: boolean;
}

/**
 * Both workflow engines use the same provider-catalog selection and receive
 * exactly the same model reference. Do not rewrite a provider prefix here and
 * do not fall back to Gateway agents.defaults.model for OpenClaw.
 */
export async function resolveWorkflowExecutionModel(
  requestedModel?: string,
): Promise<WorkflowExecutionModelSelection> {
  const normalizedRequested = requestedModel?.trim();
  const selection = await resolveAvailableClaudeModel({
    requestedModel: normalizedRequested && !CLOUD_MODEL_ALIASES.has(normalizedRequested)
      ? normalizedRequested
      : undefined,
  });
  return {
    accountId: selection.accountId,
    claudeModel: selection.model,
    openClawModel: selection.model,
    fallbackApplied: selection.fallbackApplied,
  };
}
