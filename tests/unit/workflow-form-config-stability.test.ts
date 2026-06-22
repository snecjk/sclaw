import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildWorkflowFormConfig,
  buildWorkflowFormId,
  clearWorkflowFormConfigCache,
} from '@/lib/workflow-form-utils';
import type { WorkflowSchema } from '@/types/workflow';

const sampleSchema: WorkflowSchema = {
  nodeId: 'startup_1',
  steps: [
    { id: 'step_1', title: '数据来源', mode: 'confirm' },
  ],
  fields: [
    {
      key: 'source',
      label: '数据来源',
      component: 'single_select',
      group: 'step_1',
      groupTitle: '数据来源',
      order: 1,
      required: true,
      options: [{ value: 'a', label: '选项 A' }],
    },
  ],
};

describe('workflow form config stability', () => {
  beforeEach(() => {
    clearWorkflowFormConfigCache();
  });

  it('buildWorkflowFormId is stable per template', () => {
    expect(buildWorkflowFormId('tpl_abc')).toBe('workflow-form-tpl_abc');
    expect(buildWorkflowFormId('tpl_abc')).toBe(buildWorkflowFormId('tpl_abc'));
  });

  it('buildWorkflowFormConfig returns stable id and cached reference', () => {
    const first = buildWorkflowFormConfig(sampleSchema, '', {}, {
      templateId: 'tpl_abc',
      schemaHash: 'hash_v1',
    });
    const second = buildWorkflowFormConfig(sampleSchema, '', {}, {
      templateId: 'tpl_abc',
      schemaHash: 'hash_v1',
    });

    expect(first.id).toBe('workflow-tpl_abc-hash_v1');
    expect(second.id).toBe(first.id);
    expect(second).toBe(first);
  });

  it('buildWorkflowFormConfig differs when schemaHash changes', () => {
    const v1 = buildWorkflowFormConfig(sampleSchema, '', {}, {
      templateId: 'tpl_abc',
      schemaHash: 'hash_v1',
    });
    const v2 = buildWorkflowFormConfig(sampleSchema, '', {}, {
      templateId: 'tpl_abc',
      schemaHash: 'hash_v2',
    });

    expect(v1.id).not.toBe(v2.id);
  });
});
