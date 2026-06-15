import { describe, expect, it } from 'vitest';
import {
  appendWorkflowCardBlockToMessage,
  ensureWorkflowCardsInMessages,
  patchLastAssistantWithWorkflowCard,
} from '@/lib/workflow-card-injection';
import type { RawMessage } from '@/stores/chat/types';

const getMessageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text')
    .map((b) => String((b as { text?: string }).text ?? ''))
    .join('\n');
};

describe('workflow-card-injection', () => {
  it('appends workflow_card block to assistant message', () => {
    const message: RawMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: '工作流已启动' }],
    };
    const patched = appendWorkflowCardBlockToMessage(message, 'run_123', '测试工作流');
    expect(patched.content).toEqual([
      { type: 'text', text: '工作流已启动' },
      { type: 'workflow_card', runId: 'run_123', templateName: '测试工作流' },
    ]);
  });

  it('patches assistant bubble that mentions runId', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: '再执行' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '运行 ID: run_abc 状态：运行中' }],
      },
    ];
    const patched = patchLastAssistantWithWorkflowCard(
      messages,
      'run_abc',
      '客户异常监控',
      getMessageText,
    );
    expect(patched[1].content).toEqual([
      { type: 'text', text: '运行 ID: run_abc 状态：运行中' },
      { type: 'workflow_card', runId: 'run_abc', templateName: '客户异常监控' },
    ]);
  });

  it('ensureWorkflowCardsInMessages uses execution memory when text mentions workflowId', () => {
    const sessionKey = 'agent:main:main';
    const storageKey = 'stoclaw:workflow-executions';
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        [sessionKey]: [
          {
            sessionKey,
            workflowId: 'wf_1',
            runId: 'run_999',
            templateId: 'tpl_1',
            templateName: '客户异常监控',
            status: 'running',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            collectedInputs: {},
          },
        ],
      }),
    );

    const messages: RawMessage[] = [
      { role: 'user', content: 'wf_1 再次执行' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '工作流已重新启动执行（工作流 ID: wf_1）' }],
      },
    ];

    const patched = ensureWorkflowCardsInMessages(messages, sessionKey, getMessageText);
    expect(patched[1].content).toEqual([
      { type: 'text', text: '工作流已重新启动执行（工作流 ID: wf_1）' },
      { type: 'workflow_card', runId: 'run_999', templateName: '客户异常监控' },
    ]);

    localStorage.removeItem(storageKey);
  });
});
