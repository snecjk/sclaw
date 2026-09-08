import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEngineSelectDialog } from '@/pages/Workflow/components/workflow-engine-select-dialog';
import { useAgentEnginePolicyStore } from '@/stores/agent-engine-policy';

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(async () => true),
}));

describe('WorkflowEngineSelectDialog', () => {
  beforeEach(() => {
    useAgentEnginePolicyStore.setState({
      engines: [
        { code: 'pi', name: 'PI 服务端名称', order: 10 },
        { code: 'openclaw', name: 'OpenClaw 企业版', order: 20 },
        { code: 'claude', name: 'Claude 企业版', order: 30 },
      ],
      defaultEngine: 'pi',
      loaded: true,
      loading: false,
      ownerCode: 'current-user',
      configVersion: 'test-policy',
    });
  });

  it('uses chat policy order, shared labels, descriptions, and default engine', async () => {
    render(
      <WorkflowEngineSelectDialog
        open
        workflowName="测试流程"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getAllByRole('radio')[1]).toBeEnabled());
    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.textContent)).toEqual([
      'SAgent使用SAgent执行节点',
      'OpenClaw 企业版使用OpenClaw 企业版执行节点',
      'Claude 企业版使用Claude 企业版执行节点',
    ]);
    await waitFor(() => expect(options[0]).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('button', { name: '开始运行' })).toBeEnabled();
  });
});
