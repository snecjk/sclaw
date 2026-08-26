import type { LearningCaseTargetType } from '@/types/learning-center';

export type LearningCasePromptPreview =
  | { visible: false }
  | { visible: true; kind: 'CHAT'; text: string }
  | { visible: true; kind: 'SKILL' | 'WORKFLOW'; title: string; suffix: string };

/**
 * 查看详情里的「提示词」预览：技能/工作流用选中项名称，再拼可选补充说明。
 * 补充说明为空时仍展示选中项，避免详情框空白。
 */
export function composeLearningCasePromptPreview(input: {
  targetType: LearningCaseTargetType;
  chipTitle?: string;
  targetCode?: string;
  promptText?: string | null;
}): LearningCasePromptPreview {
  const suffix = input.promptText?.trim() ?? '';
  const title = input.chipTitle?.trim() || '';

  if (input.targetType === 'CHAT') {
    return suffix ? { visible: true, kind: 'CHAT', text: suffix } : { visible: false };
  }

  if (input.targetType === 'SKILL' || input.targetType === 'WORKFLOW') {
    if (!title && !suffix) return { visible: false };
    return { visible: true, kind: input.targetType, title, suffix };
  }

  return { visible: false };
}
