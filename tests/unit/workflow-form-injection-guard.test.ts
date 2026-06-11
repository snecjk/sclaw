import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  isWorkflowFormInjectionAllowed,
  lastUserTurnIsWorkflowPicker,
} from '@/stores/chat/parameter-form-recovery';
import { WORKFLOW_CONTEXT_MARKER } from '@/lib/workflow-context';
import type { RawMessage } from '@/stores/chat';

const getMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string; text?: string }) => b.type === 'text' && b.text)
      .map((b: { text?: string }) => b.text!)
      .join('\n');
  }
  return '';
};

vi.mock('@/stores/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/chat')>();
  return {
    ...actual,
    useChatStore: {
      getState: () => ({
        pendingWorkflow: {
          templateId: 'tpl-1',
          templateName: 'Test',
          schemaHash: 'hash-1',
          schema: { fields: [], steps: [] },
          collectedInputs: {},
          modelGuidanceSent: true,
        },
        sending: false,
      }),
    },
  };
});

vi.mock('@/stores/workflow-memory', () => ({
  sessionHasWorkflowExecution: () => false,
}));

describe('workflow form injection guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows slash picker turn with pending schema', () => {
    const uiMessages: RawMessage[] = [
      { role: 'user', content: '/云端agent测试-产物测试 1' },
      { role: 'assistant', content: '请填写参数' },
    ];
    expect(
      isWorkflowFormInjectionAllowed('tpl-1', uiMessages, getMessageText, 'agent:main:main', {
        allowLivePending: true,
      }),
    ).toBe(true);
  });

  it('blocks casual last user even when schema exists in history', () => {
    const uiMessages: RawMessage[] = [
      { role: 'user', content: '随便生成一个和' },
      { role: 'assistant', content: '好的' },
    ];
    const rawMessages: RawMessage[] = [
      ...uiMessages,
      {
        role: 'tool_result',
        content: JSON.stringify({
          type: 'workflow_schema_ready',
          success: true,
          data: { templateId: 'tpl-1', schemaHash: 'hash-1' },
        }),
      },
    ];
    expect(
      isWorkflowFormInjectionAllowed('tpl-1', uiMessages, getMessageText, 'agent:main:main', {
        rawMessages,
      }),
    ).toBe(false);
  });

  it('allows display when parameter_form block already exists on assistant', () => {
    const uiMessages: RawMessage[] = [
      { role: 'user', content: '客户异常监控 创建工作流' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '请填写参数' },
          {
            type: 'parameter_form',
            formId: 'wf-1',
            formConfig: { fields: [] },
            formContext: { source: 'workflow', sourceId: 'tpl-1' },
          },
        ],
      },
    ];
    expect(
      isWorkflowFormInjectionAllowed('tpl-1', uiMessages, getMessageText, 'agent:main:main'),
    ).toBe(true);
  });

  it('detects hidden workflow_context on raw user message', () => {
    const uiMessages: RawMessage[] = [
      { role: 'user', content: '/模板A' },
      { role: 'assistant', content: '引导' },
    ];
    const rawMessages: RawMessage[] = [
      {
        role: 'user',
        content: `${WORKFLOW_CONTEXT_MARKER}\n{"templateId": "tpl-1"}\n${WORKFLOW_CONTEXT_MARKER}\n/模板A`,
      },
      { role: 'assistant', content: '引导' },
    ];
    expect(
      lastUserTurnIsWorkflowPicker('tpl-1', uiMessages, rawMessages, getMessageText),
    ).toBe(true);
  });
});
