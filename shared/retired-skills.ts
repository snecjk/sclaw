/** Preinstalled skills removed from the app; must not be read or invoked. */
export const RETIRED_SKILL_SLUGS = [
  'sto-distinctive-design',
  'cli-report-generator',
] as const;

/** OpenClaw plugins removed from the app; local copies should be deleted. */
export const RETIRED_PLUGIN_IDS = [
  'sto-distinctive-design-guard',
] as const;

export const RETIRED_SKILLS_SYSTEM_PROMPT = [
  '【已废弃技能与插件 · P0】',
  '以下技能与插件已从 SClaw 移除，禁止 read / bash / 引用其路径或 SKILL.md：',
  `- 技能：${RETIRED_SKILL_SLUGS.join('、')}`,
  `- 插件：${RETIRED_PLUGIN_IDS.join('、')}`,
  '即使用户目录或技能列表中仍存在上述文件，也视为过期残留，一律忽略。',
  '生成 HTML 报告/看板/页面时：直接按用户需求 write 到 ./.claw-output/<文件名>.html，无需先读任何 HTML 设计技能。',
].join('\n');
