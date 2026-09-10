/**
 * Claude systemPromptAppend 的唯一 join owner。
 * 不改各段措辞，只规定顺序与「哪种会话允许哪段」。
 */

export const SYSTEM_PROMPT_SECTION_IDS = [
  'cwd',
  'runtime-extensions',
  'memory',
  'caller',
  'history-bridge',
  'resume-interrupt',
  'recovery-bridge',
  'scheduled-task',
  'bridge-ai-skill',
] as const;

export type SystemPromptSectionId = (typeof SYSTEM_PROMPT_SECTION_IDS)[number];

export interface SystemPromptSection {
  id: SystemPromptSectionId;
  text?: string | null;
}

export type SystemPromptSessionKind = 'interactive' | 'embed' | 'workflow' | 'scheduled' | 'bridge';

/**
 * 会话种类 × 允许出现的段落。改组装必须同步改这张表。
 * 出现 = 允许，不表示每一轮都有正文。
 */
export const EXPECTED_SYSTEM_PROMPT_SECTIONS: Record<
  SystemPromptSessionKind,
  readonly SystemPromptSectionId[]
> = {
  interactive: [
    'cwd', 'runtime-extensions', 'memory', 'caller',
    'history-bridge', 'resume-interrupt', 'recovery-bridge',
  ],
  embed: [
    'cwd', 'runtime-extensions', 'memory', 'caller',
    'history-bridge', 'resume-interrupt', 'recovery-bridge',
  ],
  workflow: [
    'cwd', 'runtime-extensions', 'memory', 'caller',
    'history-bridge', 'resume-interrupt', 'recovery-bridge',
  ],
  scheduled: [
    'cwd', 'runtime-extensions', 'memory', 'caller',
    'history-bridge', 'resume-interrupt', 'recovery-bridge', 'scheduled-task',
  ],
  bridge: [
    'cwd', 'runtime-extensions', 'memory', 'caller',
    'history-bridge', 'resume-interrupt', 'recovery-bridge', 'bridge-ai-skill',
  ],
};

export function assembleSystemPromptAppend(sections: SystemPromptSection[]): string {
  const byId = new Map<SystemPromptSectionId, string>();
  for (const section of sections) {
    const text = section.text?.trim();
    if (!text) continue;
    const existing = byId.get(section.id);
    byId.set(section.id, existing ? `${existing}\n\n${text}` : text);
  }
  return SYSTEM_PROMPT_SECTION_IDS
    .map((id) => byId.get(id))
    .filter((text): text is string => Boolean(text))
    .join('\n\n');
}

export function isSectionAllowedForKind(
  kind: SystemPromptSessionKind,
  id: SystemPromptSectionId,
): boolean {
  return EXPECTED_SYSTEM_PROMPT_SECTIONS[kind].includes(id);
}
