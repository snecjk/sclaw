import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowComposer } from '@/pages/Workflow/components/workflow-composer';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';

function setCurrentAgentEngine(engineType: 'openclaw' | 'claude' | 'pi') {
  useAgentsStore.setState({
    agents: [{
      id: 'main',
      name: 'Main',
      isDefault: true,
      modelDisplay: 'test-model',
      inheritedModel: false,
      workspace: 'D:/workspace',
      agentDir: 'D:/agent',
      mainSessionKey: 'agent:main:main',
      channelTypes: [],
      engineType,
    }],
  });
  useChatStore.setState({
    currentAgentId: 'main',
    currentSessionKey: DEFAULT_SESSION_KEY,
    sessions: [],
  });
}

describe('WorkflowComposer engine gateway policy', () => {
  beforeEach(() => {
    useGatewayStore.setState({ status: { state: 'stopped', port: 18789 } });
  });

  it('keeps SAgent workflow generation enabled when OpenClaw Gateway is stopped', () => {
    setCurrentAgentEngine('pi');
    render(<WorkflowComposer onGenerate={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('still gates OpenClaw workflow generation on Gateway readiness', () => {
    setCurrentAgentEngine('openclaw');
    render(<WorkflowComposer onGenerate={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
