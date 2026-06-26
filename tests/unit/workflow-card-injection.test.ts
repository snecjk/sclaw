import { describe, expect, it } from 'vitest';
import {
  appendWorkflowCardBlockToMessage,
  dedupeWorkflowCardsForParamsConfirmedTurn,
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

  it('ensureWorkflowCardsInMessages attaches re-run card to current turn, not older workflowId message', () => {
    const sessionKey = 'agent:main:main';
    const storageKey = 'stoclaw:workflow-executions';
    const now = Date.now();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        [sessionKey]: [
          {
            sessionKey,
            workflowId: 'wf_1',
            runId: 'run_new',
            templateId: 'tpl_1',
            templateName: '客户异常监控',
            status: 'running',
            createdAt: now,
            updatedAt: now,
            collectedInputs: {},
          },
          {
            sessionKey,
            workflowId: 'wf_1',
            runId: 'run_old',
            templateId: 'tpl_1',
            templateName: '客户异常监控',
            status: 'completed',
            createdAt: now - 60_000,
            updatedAt: now - 30_000,
            collectedInputs: {},
          },
        ],
      }),
    );

    const messages: RawMessage[] = [
      { role: 'user', content: '首次执行' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '参数已确认，工作流已在后台启动执行（工作流 ID: wf_1）' },
          { type: 'workflow_card', runId: 'run_old', templateName: '客户异常监控' },
        ],
      },
      { role: 'user', content: '再帮我执行下 wf_1' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '工作流已重新启动执行（工作流 ID: wf_1）' }],
      },
    ];

    const patched = ensureWorkflowCardsInMessages(messages, sessionKey, getMessageText);
    expect(patched[3].content).toEqual([
      { type: 'text', text: '工作流已重新启动执行（工作流 ID: wf_1）' },
      { type: 'workflow_card', runId: 'run_new', templateName: '客户异常监控' },
    ]);
    expect(patched[1].content).toEqual(messages[1].content);

    localStorage.removeItem(storageKey);
  });

  it('dedupeWorkflowCardsForParamsConfirmedTurn strips card from model reply when params confirmed owns run', () => {
    const messages: RawMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '工作流已开始执行 run_dup' },
          { type: 'workflow_card', runId: 'run_dup', templateName: '测试' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '参数已确认，工作流已在后台启动执行（工作流 ID: wf_1）' },
          { type: 'workflow_card', runId: 'run_dup', templateName: '测试' },
        ],
      },
    ];
    const deduped = dedupeWorkflowCardsForParamsConfirmedTurn(messages, 'run_dup', getMessageText);
    expect(deduped[0].content).toEqual([
      { type: 'text', text: '工作流已开始执行 run_dup' },
    ]);
    expect(deduped[1].content).toEqual(messages[1].content);
  });

  it('patchLastAssistantWithWorkflowCard attaches to tool-only assistant snapshot', () => {
    const messages: RawMessage[] = [
      { role: 'user', content: '再执行' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'execute_workflow', input: { workflowId: 'wf_1' } }],
      },
    ];
    const patched = patchLastAssistantWithWorkflowCard(
      messages,
      'run_tool_only',
      '客户异常监控',
      getMessageText,
    );
    expect(patched[1].content).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'execute_workflow', input: { workflowId: 'wf_1' } },
      { type: 'workflow_card', runId: 'run_tool_only', templateName: '客户异常监控' },
    ]);
  });
});
