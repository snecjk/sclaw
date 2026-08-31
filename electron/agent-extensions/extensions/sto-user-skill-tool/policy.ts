import type { SclawToolPolicy } from '../../../../shared/agent-extensions';
import {
  evaluateUserSkillWriteGuard,
  shouldScheduleOrphanImportAfterTool,
} from '../../../../shared/user-skill-write-guard';
import { STO_USER_SKILL_CAPABILITY } from './capability';

export const userSkillWritePolicy: SclawToolPolicy = {
  id: 'user-skill-write-guard',
  beforeTool(event, context) {
    const decision = evaluateUserSkillWriteGuard({
      toolName: event.toolName,
      params: event.input,
    });
    if (!decision.blocked) return { action: 'allow' };
    context.logger.warn('[agent-extension] user-skill.write.denied', {
      engine: context.engine,
      extensionId: 'sto-user-skill-tool',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      matchedPath: decision.matchedPath,
    });
    return { action: 'deny', reason: decision.reason };
  },
  async afterTool(event, context) {
    if (!shouldScheduleOrphanImportAfterTool({
      toolName: event.toolName,
      params: event.input,
    })) return;

    await context.capabilities
      .require(STO_USER_SKILL_CAPABILITY)
      .scheduleOrphanImport('agent-extension-after-skill-path-tool');
    context.logger.info('[agent-extension] user-skill.orphan-import.scheduled', {
      engine: context.engine,
      extensionId: 'sto-user-skill-tool',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
  },
};
