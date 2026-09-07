import type { SclawActivationResult, SclawExtensionBuildContext } from '../../../../shared/agent-extensions';
import { STO_WORKFLOW_CAPABILITY } from './capability';

export const STO_WORKFLOW_MANAGEMENT_ACTIVATION = 'workflow-management';

export async function matchesStoWorkflowIntent(
  context: SclawExtensionBuildContext,
): Promise<SclawActivationResult> {
  const text = (context.userPrompt ?? '').normalize('NFKC').trim().toLowerCase();
  if (!text || !(/\bworkflows?\b/u.test(text) || /工作流/u.test(text))) {
    return { active: false };
  }

  const available = await context.capabilities.require(STO_WORKFLOW_CAPABILITY).isAvailable();
  return {
    active: available,
    reason: available ? 'workflow-domain' : 'workflow-auth-unavailable',
  };
}
