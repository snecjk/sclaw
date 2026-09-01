import {
  createKeywordActivationMatcher,
  type SclawActivationDefinition,
} from '../../../../shared/agent-extensions';

export const STO_USER_SKILL_ACTIVATION = 'user-skill-management';

const matchesUserSkillIntent = createKeywordActivationMatcher({
  keywords: [
    'save_user_skill',
    'skill.md',
    '我的技能',
    '用户技能',
  ],
  patterns: [
    /(?:创建|新建|生成|制作|编写|保存|更新|修改|完善|沉淀).{0,12}(?:技能|skill)/iu,
    /(?:技能|skill).{0,12}(?:创建|新建|生成|制作|编写|保存|更新|修改|完善|沉淀)/iu,
    /(?:做成|整理成|封装成|保存成).{0,8}(?:技能|skill)/iu,
  ],
  reason: 'user-skill-intent',
});

export const userSkillActivation: SclawActivationDefinition = {
  id: STO_USER_SKILL_ACTIVATION,
  scope: 'session',
  match: matchesUserSkillIntent,
};
