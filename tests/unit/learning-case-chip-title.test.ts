import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLearningCaseChipTitle } from '@/lib/learning-case-chip-title';
import type { LearningCaseAction } from '@/types/learning-center';

vi.mock('@/lib/skill-plaza-resolve', () => ({
  resolveSkillPrompt: vi.fn(),
}));

vi.mock('@/lib/workflow-api', () => ({
  listWorkflowTemplates: vi.fn(),
}));

vi.mock('@/stores/workflows', () => ({
  useWorkflowsStore: {
    getState: () => ({ templates: [] }),
  },
}));

import { resolveSkillPrompt } from '@/lib/skill-plaza-resolve';
import { listWorkflowTemplates } from '@/lib/workflow-api';

const skillMock = vi.mocked(resolveSkillPrompt);
const workflowMock = vi.mocked(listWorkflowTemplates);

function action(overrides: Partial<LearningCaseAction> = {}): LearningCaseAction {
  return {
    targetType: 'CHAT',
    targetTypeRaw: 'CHAT',
    targetCode: '',
    targetUrl: '',
    promptText: null,
    promptMode: 'REPLACE',
    promptModeRaw: 'REPLACE',
    useCount: 1,
    ...overrides,
  };
}

describe('resolveLearningCaseChipTitle', () => {
  beforeEach(() => {
    skillMock.mockReset();
    workflowMock.mockReset();
  });

  it('resolves the plaza skill title instead of a case template name', async () => {
    skillMock.mockResolvedValue({
      slug: 'finance-guanbao',
      title: '财务-看报表',
      defaultPrompt: '帮我看报表',
    });

    await expect(resolveLearningCaseChipTitle(action({
      targetType: 'SKILL',
      targetCode: 'finance-guanbao',
    }))).resolves.toBe('财务-看报表');
  });

  it('resolves the workflow template label by id', async () => {
    workflowMock.mockResolvedValue({
      items: [{ id: 'tpl_demo', label: '报价测算', description: '' }],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    await expect(resolveLearningCaseChipTitle(action({
      targetType: 'WORKFLOW',
      targetCode: 'tpl_demo',
    }))).resolves.toBe('报价测算');
  });

  it('does not use a title for CHAT drafts', async () => {
    await expect(resolveLearningCaseChipTitle(action({
      targetType: 'CHAT',
      promptText: '纯文本',
    }))).resolves.toBeUndefined();
    expect(skillMock).not.toHaveBeenCalled();
    expect(workflowMock).not.toHaveBeenCalled();
  });
});
