import { describe, expect, it } from 'vitest';
import { buildWorkflowCronTaskMessage } from '@/lib/workflow-cron-task';

describe('buildWorkflowCronTaskMessage', () => {
  it('builds execute workflow instruction from workflow id', () => {
    expect(buildWorkflowCronTaskMessage('wf_2c200d96')).toBe('执行 wf_2c200d96 工作流');
  });
});
