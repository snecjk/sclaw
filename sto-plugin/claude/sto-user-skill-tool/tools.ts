/**
 * Claude MCP: save_user_skill — persists agent-created skills via Main saveUserSkill.
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from '../zod-shim.js';
import {
  saveUserSkill,
  SaveUserSkillError,
} from '../../../electron/services/skills/create-user-skill';

export const USER_SKILL_SYSTEM_PROMPT = [
  '用户技能保存（save_user_skill，硬性规则）：',
  '- 在会话中**创建或更新用户技能**时，必须调用 `save_user_skill`，传入完整 `skillMd`（含 YAML frontmatter 的 name + description）与 `slug`。',
  '- ⛔ **禁止**用 Write / Edit / Bash 把技能写到 openclaw/skills、workspace/skills、skills-store——系统会拦截；那样也不会进入「我的技能」。',
  '- 可选 `assets` 附加相对技能根的文件；禁止路径穿越（`..`）。',
  '- 同 slug 默认覆盖已有用户技能；系统预装白名单 slug 会被拒绝。',
].join('\n');

interface UserSkillEnvelope<T = unknown> {
  type: string;
  success: boolean;
  domain: 'user-skill';
  message?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

function resultFromEnvelope(envelope: UserSkillEnvelope): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    isError: !envelope.success,
  };
}

function successResult<T>(type: string, data: T, message?: string): CallToolResult {
  return resultFromEnvelope({
    type,
    success: true,
    domain: 'user-skill',
    message,
    data,
  });
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof SaveUserSkillError ? error.code : 'SAVE_USER_SKILL_ERROR';
  return resultFromEnvelope({
    type: 'user_skill_error',
    success: false,
    domain: 'user-skill',
    message,
    error: { code, message },
  });
}

const assetSchema = z.object({
  path: z.string().min(1).describe('相对技能根的文件路径'),
  content: z.string().describe('文件内容'),
  encoding: z.enum(['utf8', 'base64']).optional().describe('默认 utf8'),
});

export function createUserSkillMcpServer() {
  const saveUserSkillTool = tool(
    'save_user_skill',
    [
      '将会话创建/更新的技能写入当前登录用户的 skills-store（「我的技能」）。',
      '必须传入完整 SKILL.md 文本（含 name/description frontmatter）。',
      '禁止仅用 write 写到引擎 skills 或 workspace/skills。',
    ].join('\n'),
    {
      slug: z
        .string()
        .optional()
        .describe('技能 slug（小写、连字符）；缺省时从 frontmatter name 推导'),
      skillMd: z.string().min(1).describe('完整 SKILL.md 内容（必须含 YAML frontmatter）'),
      name: z.string().optional().describe('可选显示名覆盖'),
      description: z.string().optional().describe('可选描述覆盖'),
      assets: z.array(assetSchema).optional().describe('可选附加文件'),
      force: z
        .boolean()
        .optional()
        .describe('默认 true：覆盖已有同 slug 用户技能；false 则已存在时报错'),
    },
    async (input) => {
      try {
        const data = await saveUserSkill({
          slug: input.slug,
          skillMd: input.skillMd,
          name: input.name,
          description: input.description,
          assets: input.assets,
          force: input.force,
        });
        return successResult('user_skill_saved', data, `已保存用户技能 ${data.slug}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return createSdkMcpServer({
    name: 'sto-user-skill-tool',
    version: '1.0.0',
    tools: [saveUserSkillTool],
  });
}
