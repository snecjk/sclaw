import { describe, expect, it } from 'vitest';
import {
  buildWorkflowParameterIntroText,
  buildWorkflowParameterModelGuidanceFromSteps,
  collectWorkflowConfirmStepTitles,
} from '@/lib/workflow-form-utils';
import type { WorkflowSchema } from '@/types/workflow';
import { buildWorkflowContextText } from '@/lib/workflow-context';

const schema: WorkflowSchema = {
  nodeId: 'n1',
  enabled: true,
  steps: [
    { id: 's1', title: '数据取数', mode: 'confirm', order: 1 },
    { id: 's2', title: '数据处理', mode: 'confirm', order: 2 },
  ],
  fields: [
    {
      key: 'dataSource',
      label: '数据来源',
      group: 's1',
      order: 1,
      component: 'single_select',
    },
    {
      key: 'VOLUME_ABNORMAL',
      label: '单量异常',
      group: 's2',
      order: 2,
      component: 'titled_group',
      items: [{ fieldKey: 'SERIOUS_DROP', label: '严重降量阈值' }],
    },
  ],
};

describe('collectWorkflowConfirmStepTitles', () => {
  it('uses confirm step titles from schema.steps', () => {
    expect(collectWorkflowConfirmStepTitles(schema)).toEqual(['数据取数', '数据处理']);
  });
});

describe('buildWorkflowParameterIntroText', () => {
  it('lists business steps without field keys', () => {
    const text = buildWorkflowParameterIntroText('产物测试', schema);
    expect(text).toContain('数据取数');
    expect(text).toContain('数据处理');
    expect(text).not.toContain('dataSource');
    expect(text).not.toContain('SERIOUS_DROP');
  });
});

describe('buildWorkflowParameterModelGuidanceFromSteps', () => {
  it('forbids dumping field keys in model replies', () => {
    const text = buildWorkflowParameterModelGuidanceFromSteps('产物测试', ['数据取数', '数据处理']);
    expect(text).toContain('禁止输出字段 key');
    expect(text).not.toContain('dataSource');
  });
});

describe('buildWorkflowContextText', () => {
  it('injects confirm steps only in hidden context', () => {
    const text = buildWorkflowContextText({
      type: 'workflow_context',
      templateId: 'tpl_1',
      templateName: '产物测试',
      schemaHash: 'hash_1',
      confirmSteps: ['数据取数', '数据处理'],
      fields: [],
    });
    expect(text).toContain('confirmSteps');
    expect(text).toContain('数据取数');
    expect(text).not.toContain('dataSource');
    expect(text).not.toContain('SERIOUS_DROP');
  });
});
