import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  WORKFLOW_BACK_REQUEST,
  WORKFLOW_EDITOR_READY,
  WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  WORKFLOW_LOCAL_RUN_HISTORY_REQUEST,
  WORKFLOW_SAVE_DRAFT_ERROR,
  WORKFLOW_SAVE_DRAFT_RESPONSE,
  WORKFLOW_TRY_RUN_REQUEST,
  isWorkflowBackRequest,
  isWorkflowEditorReady,
  isWorkflowLocalRunHistoryRequest,
  isWorkflowSaveDraftError,
  isWorkflowSaveDraftResponse,
  isWorkflowTryRunRequest,
} from '@/lib/workflow-iframe-bridge';
import type {
  WorkflowBridgeStartupSchema,
  WorkflowDraftSnapshot,
  WorkflowSavedDraftSnapshot,
  WorkflowTryRunState,
} from '@/lib/workflow-iframe-bridge';
import type { WorkflowSchema } from '@/types/workflow';

const envelope = {
  protocol: WORKFLOW_IFRAME_BRIDGE_PROTOCOL,
  workflowId: 'wf_123',
  nonce: 'nonce-1',
  requestId: 'req-1',
};

const nonEmptyStartupSchema = {
  nodeId: 'trigger-1',
  enabled: true,
  steps: [{ id: 'step-1', title: '填写参数', mode: 'confirm', order: 1 }],
  fields: [
    {
      key: 'topic',
      label: '主题',
      description: '请输入主题',
      group: 'basic',
      groupTitle: '基础信息',
      order: 1,
      component: 'text',
      required: true,
      sourceNodes: ['trigger-1'],
      defaultValue: '月报',
      options: [{ value: 'monthly', label: '月报', description: '按月生成', tags: ['report'] }],
      items: [{ fieldKey: 'detail', label: '详情', description: '补充信息', defaultValue: '无' }],
    },
  ],
};

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

describe('workflow iframe bridge v1 business messages', () => {
  it('exposes stable runtime terminal states to the Host sender', () => {
    expectTypeOf<'cancelled' | 'failed' | 'completed'>()
      .toMatchTypeOf<WorkflowTryRunState>();
  });

  it('keeps legacy runtime snapshots separate from save-before-run wire snapshots', () => {
    expectTypeOf<WorkflowDraftSnapshot['startup']['schema']>().toEqualTypeOf<WorkflowSchema | null>();
    expectTypeOf<WorkflowSavedDraftSnapshot['startup']['schema']>()
      .toEqualTypeOf<WorkflowBridgeStartupSchema | null>();
  });

  it('accepts only the exact editor capabilities', () => {
    const message = {
      ...envelope,
      type: WORKFLOW_EDITOR_READY,
      capabilities: ['ownsHeader', 'persistBeforeTrialRun'],
    };

    expect(isWorkflowEditorReady(message)).toBe(true);
    expect(isWorkflowEditorReady({ ...message, capabilities: ['ownsHeader', 'unknown'] })).toBe(false);
    expect(isWorkflowEditorReady({ ...message, capabilities: 'ownsHeader' })).toBe(false);
  });

  it.each([
    ['editor ready', { ...envelope, type: WORKFLOW_EDITOR_READY, capabilities: ['ownsHeader'] }, isWorkflowEditorReady],
    ['try run', { ...envelope, type: WORKFLOW_TRY_RUN_REQUEST }, isWorkflowTryRunRequest],
    ['back', { ...envelope, type: WORKFLOW_BACK_REQUEST }, isWorkflowBackRequest],
    ['local run history', { ...envelope, type: WORKFLOW_LOCAL_RUN_HISTORY_REQUEST }, isWorkflowLocalRunHistoryRequest],
    [
      'save response',
      {
        ...envelope,
        type: WORKFLOW_SAVE_DRAFT_RESPONSE,
        workflowVersionId: 'ver_3',
        schemaVersion: 'workflow/v2',
        versionStatus: 'draft',
        startup: { schema: null, defaultValues: {} },
      },
      isWorkflowSaveDraftResponse,
    ],
    [
      'save error',
      { ...envelope, type: WORKFLOW_SAVE_DRAFT_ERROR, message: 'save failed' },
      isWorkflowSaveDraftError,
    ],
  ] as const)('requires the complete authenticated envelope for %s', (_label, message, validator) => {
    for (const field of ['protocol', 'type', 'workflowId', 'nonce', 'requestId']) {
      expect(validator(withoutField(message, field))).toBe(false);
    }
  });

  it('requires a persisted workflow/v2 draft snapshot with startup data', () => {
    const message = {
      ...envelope,
      type: WORKFLOW_SAVE_DRAFT_RESPONSE,
      workflowVersionId: 'ver_3',
      schemaVersion: 'workflow/v2',
      versionStatus: 'draft',
      startup: { schema: null, defaultValues: {} },
    };

    expect(isWorkflowSaveDraftResponse(message)).toBe(true);

    for (const field of ['workflowVersionId', 'schemaVersion', 'versionStatus', 'startup']) {
      expect(isWorkflowSaveDraftResponse(withoutField(message, field))).toBe(false);
    }

    expect(isWorkflowSaveDraftResponse({ ...message, versionStatus: 'published' })).toBe(false);
    expect(isWorkflowSaveDraftResponse({ ...message, schemaVersion: 'workflow/v1' })).toBe(false);
    expect(isWorkflowSaveDraftResponse({ ...message, workflowVersionId: null })).toBe(false);
    expect(isWorkflowSaveDraftResponse({ ...message, startup: { defaultValues: {} } })).toBe(false);
    expect(isWorkflowSaveDraftResponse({ ...message, startup: { schema: null } })).toBe(false);
    expect(isWorkflowSaveDraftResponse({ ...message, startup: { schema: null, defaultValues: null } })).toBe(false);
  });

  it('accepts the non-empty Web startup wire schema', () => {
    expect(isWorkflowSaveDraftResponse({
      ...envelope,
      type: WORKFLOW_SAVE_DRAFT_RESPONSE,
      workflowVersionId: 'ver_3',
      schemaVersion: 'workflow/v2',
      versionStatus: 'draft',
      startup: { schema: nonEmptyStartupSchema, defaultValues: { topic: '月报' } },
    })).toBe(true);
  });

  it.each([
    ['nodeId', { ...nonEmptyStartupSchema, nodeId: 42 }],
    ['enabled', { ...nonEmptyStartupSchema, enabled: 'yes' }],
    ['steps', { ...nonEmptyStartupSchema, steps: {} }],
    ['step id', { ...nonEmptyStartupSchema, steps: [{ id: 1, title: '填写参数' }] }],
    ['step title', { ...nonEmptyStartupSchema, steps: [{ id: 'step-1', title: false }] }],
    ['step mode', { ...nonEmptyStartupSchema, steps: [{ id: 'step-1', title: '填写参数', mode: 1 }] }],
    ['step order', { ...nonEmptyStartupSchema, steps: [{ id: 'step-1', title: '填写参数', order: '1' }] }],
    ['fields', { ...nonEmptyStartupSchema, fields: {} }],
    ['field key', { ...nonEmptyStartupSchema, fields: [{ key: 1, label: '主题', group: 'basic' }] }],
    ['field label', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: 1, group: 'basic' }] }],
    ['field group', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: null }] }],
    ['field description', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', description: 1 }] }],
    ['field groupTitle', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', groupTitle: false }] }],
    ['field order', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', order: '1' }] }],
    ['field component', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', component: 1 }] }],
    ['field required', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', required: 'yes' }] }],
    ['field sourceNodes', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', sourceNodes: [1] }] }],
    ['option', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', options: [{ value: 1, label: '月报' }] }] }],
    ['option tags', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', options: [{ value: 'monthly', label: '月报', tags: [1] }] }] }],
    ['item', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', items: [{ fieldKey: 1, label: '详情' }] }] }],
    ['item defaultValue', { ...nonEmptyStartupSchema, fields: [{ key: 'topic', label: '主题', group: 'basic', items: [{ fieldKey: 'detail', label: '详情', defaultValue: 1 }] }] }],
  ])('rejects a malformed startup schema %s', (_label, schema) => {
    expect(isWorkflowSaveDraftResponse({
      ...envelope,
      type: WORKFLOW_SAVE_DRAFT_RESPONSE,
      workflowVersionId: 'ver_3',
      schemaVersion: 'workflow/v2',
      versionStatus: 'draft',
      startup: { schema, defaultValues: {} },
    })).toBe(false);
  });

  it('requires an error message string', () => {
    const message = { ...envelope, type: WORKFLOW_SAVE_DRAFT_ERROR, message: 'save failed' };

    expect(isWorkflowSaveDraftError(message)).toBe(true);
    expect(isWorkflowSaveDraftError(withoutField(message, 'message'))).toBe(false);
    expect(isWorkflowSaveDraftError({ ...message, message: 500 })).toBe(false);
  });
});
