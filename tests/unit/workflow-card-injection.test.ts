import { describe, expect, it } from 'vitest';
import { currentUserTurnHasWorkflowSubmission } from '@/lib/workflow-card-injection';

describe('legacy workflow form submission marker', () => {
  it('can suppress an old submitted form without participating in card discovery', () => {
    expect(currentUserTurnHasWorkflowSubmission([
      { id: 'user-1', role: 'user', content: '启动工作流' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: [
          { type: 'text', text: '参数已确认' },
          { type: 'workflow_card', runId: 'run-old', templateName: '旧工作流' },
        ],
      },
    ])).toBe(true);
  });
});
