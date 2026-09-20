import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { STO_USER_SKILL_ACTIVATION, userSkillActivation } from './activation';
import { STO_SKILL_RUNTIME_CAPABILITY } from './capability';
import { searchSkillsTool } from './operations';
import { runtimeSkillReadPolicy } from './policy';
import { saveUserSkillTool, deleteUserSkillTool } from './user-operations';
import { userSkillWritePolicy } from './user-policy';

const SKILL_RUNTIME_PROMPT = [
  '运行时技能发现：',
  '- 会话开始时匹配到的技能已由当前引擎按原生 Skill 机制提供；正常使用它们。',
  '- 只有执行过程中发现现有技能不足时，才调用 `search_skills` 描述缺少的能力。',
  '- `search_skills` 返回本机校验后的 `skillMdPath`。选择候选后，用引擎原生 `Read/read` 读取该文件。',
  '- SKILL.md 引用包内其他文件时，继续使用原生文件读取工具渐进读取，不要猜测路径。',
].join('\n');

export const USER_SKILL_SYSTEM_PROMPT = [
  '用户技能保存（save_user_skill，硬性规则）：',
  '- 在会话中**创建或更新用户技能**时，必须调用 `save_user_skill`，传入完整 `skillMd`（含 YAML frontmatter 的 name + description）与 `slug`。',
  '- ⛔ **禁止**用 Write / Edit / apply_patch / Bash 把技能写到 openclaw/skills、workspace/skills、skills-store——系统会拦截；那样也不会进入「我的技能」。',
  '- 改显示名称时保留原 slug 和完整正文，用 name 参数传入新显示名；先读取原文件，不要凭记忆重写。',
  '- 只有用户要求创建或修改技能时才保存；查询、讨论、执行技能不要调用保存工具。',
  '- 可选 `assets` 附加相对技能根的文件；禁止路径穿越（`..`）。',
  '- 用户明确要求删除技能时调用 delete_user_skill，先确定准确 slug；目标不明时询问，不要使用文件或 Shell 删除。',
  '- 同 slug 默认覆盖已有用户技能；系统预装白名单 slug 会被拒绝。',
].join('\n');

export const stoSkillRuntimeDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-skill-runtime',
  version: '1.0.0',
  engines: ['claude', 'pi'],
  requiredCapabilities: [STO_SKILL_RUNTIME_CAPABILITY],
  activations: [userSkillActivation],
  tools: [searchSkillsTool, saveUserSkillTool, deleteUserSkillTool],
  policies: [runtimeSkillReadPolicy, userSkillWritePolicy],
  prompts: [{
    id: 'skill-runtime-guidance',
    text: SKILL_RUNTIME_PROMPT,
  }, {
    id: 'user-skill-guidance',
    modes: ['interactive'],
    activation: STO_USER_SKILL_ACTIVATION,
    text: USER_SKILL_SYSTEM_PROMPT,
  }],
};
