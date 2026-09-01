import type { SclawToolPolicy } from '../../../../shared/agent-extensions';
import { findRuntimeSkillCandidateForRead } from './access';
import { STO_SKILL_RUNTIME_CAPABILITY } from './capability';

function requestedReadPath(input: Record<string, unknown>): string | undefined {
  for (const key of ['file_path', 'path']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export const runtimeSkillReadPolicy: SclawToolPolicy = {
  id: 'runtime-skill-read',
  async beforeTool(event, context) {
    if (event.toolName !== 'read') return { action: 'allow' };
    const requestedPath = requestedReadPath(event.input);
    if (!requestedPath) return { action: 'allow' };
    const match = await findRuntimeSkillCandidateForRead({
      sessionKey: context.sessionKey,
      runId: context.runId,
      requestedPath,
      cwd: context.cwd,
    });
    return match
      ? { action: 'allow', permissionDecision: 'allow' }
      : { action: 'allow' };
  },
  async afterTool(event, context) {
    if (event.toolName !== 'read' || event.isError) return;
    const requestedPath = requestedReadPath(event.input);
    if (!requestedPath) return;
    const match = await findRuntimeSkillCandidateForRead({
      sessionKey: context.sessionKey,
      runId: context.runId,
      requestedPath,
      cwd: context.cwd,
    });
    if (!match) return;
    const { candidate } = match;
    await context.capabilities.require(STO_SKILL_RUNTIME_CAPABILITY).recordRead({
      sessionKey: context.sessionKey,
      runId: context.runId,
      agentId: context.agentId,
      slug: candidate.slug,
      sourceHash: candidate.sourceHash,
      requestedPath: match.resolvedPath,
    });
  },
};
