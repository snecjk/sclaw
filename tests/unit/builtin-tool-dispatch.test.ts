import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchBuiltinToolResult,
  resetBuiltinToolDispatchDedupe,
} from '@/lib/builtin-tool-dispatch';

const applyWorkflowSchemaReady = vi.fn();
const ensureWorkflowParameterFormInjected = vi.fn(() => false);

vi.mock('@/stores/chat/parameter-form-recovery', () => ({
  applyWorkflowSchemaReady: (...args: unknown[]) => applyWorkflowSchemaReady(...args),
  ensureWorkflowParameterFormInjected: () => ensureWorkflowParameterFormInjected(),
}));

vi.mock('@/stores/workflow-memory', () => ({
  saveWorkflowRecord: vi.fn(),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
    }),
  },
}));

vi.mock('@/lib/workflow-run-started', () => ({
  applyWorkflowRunStarted: vi.fn(async () => true),
}));

describe('dispatchBuiltinToolResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBuiltinToolDispatchDedupe();
  });

  it('handles workflow_schema_ready envelope', async () => {
    const handled = await dispatchBuiltinToolResult({
      id: 'tool-1',
      content: JSON.stringify({
        type: 'workflow_schema_ready',
        success: true,
        domain: 'workflow',
        data: {
          templateId: 'tpl-1',
          schemaHash: 'h1',
          schema: { fields: [], steps: [], nodeId: '', enabled: true },
        },
      }),
    });
    expect(handled).toBe(true);
    expect(applyWorkflowSchemaReady).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 'tpl-1' }),
    );
  });

  it('dedupes by tool result id', async () => {
    const msg = {
      id: 'tool-dup',
      content: JSON.stringify({
        type: 'workflow_schema_ready',
        success: true,
        domain: 'workflow',
        data: {
          templateId: 'tpl-1',
          schemaHash: 'h1',
          schema: { fields: [], steps: [], nodeId: '', enabled: true },
        },
      }),
    };
    expect(await dispatchBuiltinToolResult(msg)).toBe(true);
    expect(await dispatchBuiltinToolResult(msg)).toBe(false);
    expect(applyWorkflowSchemaReady).toHaveBeenCalledTimes(1);
  });
});
