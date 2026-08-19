/**
 * Chip label for learning-case「立即使用」must be the selected skill / workflow
 * name, never the case template title.
 */
import { resolveSkillPrompt } from '@/lib/skill-plaza-resolve';
import { listWorkflowTemplates } from '@/lib/workflow-api';
import { useWorkflowsStore } from '@/stores/workflows';
import type { LearningCaseAction } from '@/types/learning-center';

export async function resolveLearningCaseChipTitle(
  action: Pick<LearningCaseAction, 'targetType' | 'targetCode'>,
): Promise<string | undefined> {
  const code = action.targetCode.trim();
  if (!code) return undefined;

  if (action.targetType === 'SKILL') {
    return (await resolveSkillPrompt(code)).title;
  }

  if (action.targetType === 'WORKFLOW') {
    const cached = useWorkflowsStore.getState().templates.find((item) => item.id === code);
    if (cached?.label?.trim()) return cached.label.trim();
    try {
      const result = await listWorkflowTemplates({ query: code, page: 1, pageSize: 20 });
      const matched = result.items.find((item) => item.id === code);
      return matched?.label?.trim() || code;
    } catch {
      return code;
    }
  }

  return undefined;
}
