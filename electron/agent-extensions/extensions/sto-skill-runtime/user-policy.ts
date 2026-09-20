import type { SclawToolPolicy } from '../../../../shared/agent-extensions';
import {
  evaluateUserSkillWriteGuard,
  shouldScheduleOrphanImportAfterTool,
} from '../../../../shared/user-skill-write-guard';
import { USER_SKILL_WRITE_ATTEMPT } from './activation';
import { STO_SKILL_RUNTIME_CAPABILITY } from './capability';

export const userSkillWritePolicy: SclawToolPolicy = {
  id: 'user-skill-write-guard',
  beforeTool(event, context) {
    const decision = evaluateUserSkillWriteGuard({
      toolName: event.toolName,
      params: event.input,
    });
    if (!decision.blocked) return { action: 'allow' };
    context.state.session.set(USER_SKILL_WRITE_ATTEMPT, true);
    context.logger.warn('[agent-extension] user-skill.write.denied', {
      engine: context.engine,
      extensionId: 'sto-skill-runtime',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      matchedPath: decision.matchedPath,
    });
    const reason = context.engine === 'claude'
      ? decision.reason.replaceAll('save_user_skill', 'mcp__sto-skill-runtime__save_user_skill')
      : decision.reason;
    return { action: 'deny', reason };
  },
  async afterTool(event, context) {
    if (!shouldScheduleOrphanImportAfterTool({
      toolName: event.toolName,
      params: event.input,
    })) return;

    await context.capabilities
      .require(STO_SKILL_RUNTIME_CAPABILITY)
      .scheduleOrphanImport('agent-extension-after-skill-path-tool');
    context.logger.info('[agent-extension] user-skill.orphan-import.scheduled', {
      engine: context.engine,
      extensionId: 'sto-skill-runtime',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    });
  },
};
