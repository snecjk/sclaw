import { Type, type Static } from 'typebox';
import {
  sclawToolFailure,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import { STO_USER_SKILL_ACTIVATION } from './activation';
import {
  STO_SKILL_RUNTIME_CAPABILITY,
  StoSkillRuntimePortError,
  type SaveUserSkillResponse,
} from './capability';

const assetSchema = Type.Object({
  path: Type.String({ minLength: 1, description: '相对技能根的文件路径' }),
  content: Type.String({ description: '文件内容' }),
  encoding: Type.Optional(Type.Union([
    Type.Literal('utf8'),
    Type.Literal('base64'),
  ], { description: '默认 utf8' })),
});

const saveUserSkillSchema = Type.Object({
  slug: Type.Optional(Type.String({
    description: '技能 slug（小写、连字符）；缺省时从 frontmatter name 推导',
  })),
  skillMd: Type.String({
    minLength: 1,
    description: '完整 SKILL.md 内容（必须含 YAML frontmatter）',
  }),
  name: Type.Optional(Type.String({ description: '可选显示名覆盖' })),
  description: Type.Optional(Type.String({ description: '可选描述覆盖' })),
  assets: Type.Optional(Type.Array(assetSchema, { description: '可选附加文件' })),
  force: Type.Optional(Type.Boolean({
    description: '默认 true：覆盖已有同 slug 用户技能；false 则已存在时报错',
  })),
});

export const saveUserSkillTool: SclawToolDefinition<
  typeof saveUserSkillSchema,
  SaveUserSkillResponse
> = {
  name: 'save_user_skill',
  label: '保存用户技能',
  description: [
    '将会话创建/更新的技能写入当前登录用户的 skills-store（「我的技能」）。',
    '必须传入完整 SKILL.md 文本（含 name/description frontmatter）。',
    '禁止仅用文件或 shell 工具写入技能目录。',
  ].join(' '),
  parameters: saveUserSkillSchema,
  modes: ['interactive'],
  activation: STO_USER_SKILL_ACTIVATION,
  async execute(
    input: Static<typeof saveUserSkillSchema>,
    context,
  ): Promise<SclawToolOutcome<SaveUserSkillResponse>> {
    try {
      const data = await context.capabilities.require(STO_SKILL_RUNTIME_CAPABILITY).save(input);
      return {
        success: true,
        type: 'user_skill_saved',
        domain: 'user-skill',
        message: `已保存用户技能 ${data.slug}`,
        data,
      };
    } catch (error) {
      const code = error instanceof StoSkillRuntimePortError
        ? error.code
        : 'SAVE_USER_SKILL_ERROR';
      return sclawToolFailure(
        'user-skill',
        code,
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};
