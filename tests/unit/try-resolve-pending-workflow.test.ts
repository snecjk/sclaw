import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WorkflowSchemaField } from '@/types/workflow';

const mockChatState = vi.hoisted(() => ({
  pendingWorkflow: null as {
    templateId: string;
    templateName: string;
    schemaHash: string;
    schema: { fields: WorkflowSchemaField[]; steps: unknown[] };
    collectedInputs: Record<string, unknown>;
    modelGuidanceSent: boolean;
  } | null,
  clearPendingWorkflowMemoryCalls: 0,
  messages: [] as unknown[],
  setStateMessages: [] as unknown[],
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      workflowChatUiBySessionKey: {
        'agent:main:session-test': {
          pendingWorkflow: mockChatState.pendingWorkflow,
          formDecorations: [],
        },
      },
      currentSessionKey: 'agent:main:session-test',
      currentAgentId: 'main',
      messages: mockChatState.messages,
      clearPendingWorkflowMemory: () => {
        mockChatState.clearPendingWorkflowMemoryCalls += 1;
        mockChatState.pendingWorkflow = null;
      },
      clearPendingWorkflow: vi.fn(),
      setPendingWorkflow: vi.fn(),
    }),
    setState: (updater: (s: { messages: unknown[] }) => { messages: unknown[] }) => {
      const next = updater({ messages: mockChatState.messages });
      mockChatState.setStateMessages = next.messages;
    },
  },
}));

describe('tryResolvePendingWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatState.pendingWorkflow = null;
    mockChatState.clearPendingWorkflowMemoryCalls = 0;
    mockChatState.messages = [];
    mockChatState.setStateMessages = [];
  });

  it('does not intercept workflow creation intent when stale pending exists', async () => {
    mockChatState.pendingWorkflow = {
      templateId: 'tpl_monitor',
      templateName: '客户异常监控',
      schemaHash: 'hash-1',
      schema: {
        fields: [
          {
            key: 'sources',
            label: '数据来源',
            component: 'editable_list',
            required: true,
          } as WorkflowSchemaField,
        ],
        steps: [],
      },
      collectedInputs: {},
      modelGuidanceSent: true,
    };

    const { tryResolvePendingWorkflow } = await import('@/hooks/use-workflow-send');
    const sendMessage = vi.fn(async () => {});
    const resolved = await tryResolvePendingWorkflow(
      '客户异常监控 创建工作流',
      sendMessage,
    );

    expect(resolved).toBe(false);
    expect(mockChatState.clearPendingWorkflowMemoryCalls).toBe(1);
    expect(mockChatState.setStateMessages).toHaveLength(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
