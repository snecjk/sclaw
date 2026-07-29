/**
 * Makes the skills visible to a workflow match the skills visible to ordinary
 * chat for the active user.  Workflow is deliberately not an agent scope:
 * agent-specific packages belong to a business/chat agent, not the isolated
 * workflow-runtime service agent.
 */
import { logger } from '../../utils/logger';
import { getCurrentActiveUserCode } from '../user-skill-workspace';
import { getSkillManager } from '../skills/skill-manager';
import type { EngineSkillId } from '../skills/adapters/engine-skill-adapter';

export async function prepareWorkflowSkills(
  engines: EngineSkillId[],
): Promise<void> {
  try {
    const userCode = await getCurrentActiveUserCode();
    // Intentionally omit agentId: this resolves global + active-user packages
    // only, exactly the skill scope shared by normal chat.
    await getSkillManager().reconcile({ userCode }, engines);
  } catch (error) {
    // Skill projection is best-effort in chat too.  A transient projection
    // failure must not prevent a workflow node from executing.
    logger.warn('[workflow-skills] failed to prepare workflow skills', {
      engines,
      error,
    });
  }
}
