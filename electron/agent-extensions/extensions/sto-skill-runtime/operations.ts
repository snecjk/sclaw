import { Type, type Static } from 'typebox';
import { sclawToolFailure, type SclawToolDefinition } from '../../../../shared/agent-extensions';
import { STO_SKILL_RUNTIME_CAPABILITY, StoSkillRuntimePortError, type RuntimeSkillSearchResponse } from './capability';
import { registerRuntimeSkillCandidates } from './access';

const searchSchema = Type.Object({
  query: Type.String({ minLength: 1, description: '描述当前缺少的能力或要完成的具体任务' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: '返回数量，默认 5' })),
});

export const searchSkillsTool: SclawToolDefinition<typeof searchSchema, RuntimeSkillSearchResponse> = {
  name: 'search_skills',
  label: '搜索技能',
  description: '搜索用户适合当前任务的技能。当前已提供的技能不足时调用。',
  parameters: searchSchema,
  async execute(input: Static<typeof searchSchema>, context) {
    try {
      if (!context.runId) {
        return sclawToolFailure(
          'skill-runtime',
          'RUNTIME_RUN_UNAVAILABLE',
          'Runtime Skill search requires an active run',
        );
      }
      const data = await context.capabilities.require(STO_SKILL_RUNTIME_CAPABILITY).search({
        sessionKey: context.sessionKey,
        runId: context.runId,
        agentId: context.agentId,
        engine: context.engine,
        mode: context.mode,
        ...input,
      });
      registerRuntimeSkillCandidates(context.sessionKey, context.runId, data.items);
      return {
        success: true,
        type: 'skills_searched',
        domain: 'skill-runtime',
        message: data.items.length > 0 ? `找到 ${data.items.length} 个候选技能` : '未找到匹配技能',
        data,
      };
    } catch (error) {
      return sclawToolFailure(
        'skill-runtime',
        error instanceof StoSkillRuntimePortError ? error.code : 'SKILL_SEARCH_FAILED',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};
