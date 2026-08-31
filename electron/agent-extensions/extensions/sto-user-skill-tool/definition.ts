import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { STO_USER_SKILL_ACTIVATION, userSkillActivation } from './activation';
import { STO_USER_SKILL_CAPABILITY } from './capability';
import { saveUserSkillTool } from './operations';
import { userSkillWritePolicy } from './policy';

export const USER_SKILL_SYSTEM_PROMPT = [
  '用户技能保存（save_user_skill，硬性规则）：',
  '- 在会话中**创建或更新用户技能**时，必须调用 `save_user_skill`，传入完整 `skillMd`（含 YAML frontmatter 的 name + description）与 `slug`。',
  '- ⛔ **禁止**用 Write / Edit / apply_patch / Bash 把技能写到 openclaw/skills、workspace/skills、skills-store——系统会拦截；那样也不会进入「我的技能」。',
  '- 可选 `assets` 附加相对技能根的文件；禁止路径穿越（`..`）。',
  '- 同 slug 默认覆盖已有用户技能；系统预装白名单 slug 会被拒绝。',
].join('\n');

export const stoUserSkillToolDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-user-skill-tool',
  version: '1.0.0',
  engines: ['claude', 'pi'],
  requiredCapabilities: [STO_USER_SKILL_CAPABILITY],
  activations: [userSkillActivation],
  tools: [saveUserSkillTool],
  policies: [userSkillWritePolicy],
  prompts: [{
    id: 'user-skill-guidance',
    modes: ['interactive'],
    activation: STO_USER_SKILL_ACTIVATION,
    text: USER_SKILL_SYSTEM_PROMPT,
  }],
};
