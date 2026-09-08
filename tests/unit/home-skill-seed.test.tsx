import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '@/pages/Home';
import { useAgentEnginePolicyStore } from '@/stores/agent-engine-policy';

const observedSeeds: Array<string | undefined> = [];
const cleanupEmptySession = vi.fn();
const handleHubSend = vi.fn();
const configureWorkflowRunSession = vi.fn();
let navigateToQuery: (() => void) | undefined;

const chatState = {
  cleanupEmptySession,
  currentSessionKey: 'agent:main:session-workflow',
  currentAgentId: 'main',
  messages: [],
  sessions: [{ key: 'agent:main:session-workflow', engineType: 'claude' }],
  sending: false,
  pendingFinal: false,
  streamingMessage: null,
  streamingText: '',
  streamingTools: [],
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    user: null,
    isAuthenticated: false,
    siteDepartmentTypes: [],
  }),
  isSiteUser: () => false,
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
}));

vi.mock('@/lib/workflow-run-session-engine', () => ({
  configureWorkflowRunSession,
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    status: { state: 'running' },
  }),
}));

vi.mock('@/stores/scheduledTasks', () => ({
  useScheduledTasksStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    createTask: vi.fn(),
    fetchTasks: vi.fn(),
  }),
}));

vi.mock('@/stores/message-queue', () => ({
  createAutoSendWatcher: () => () => {},
}));

vi.mock('@/pages/Home/HomeAgentHubSurface', () => ({
  HomeAgentHubSurface: ({ seedSkillSlug }: { seedSkillSlug?: string }) => {
    const navigate = useNavigate();
    observedSeeds.push(seedSkillSlug);
    navigateToQuery = () => navigate('/?q=legacy-query');
    return <div data-testid="home-agent-hub" />;
  },
}));

vi.mock('@/hooks/use-split-grid-passthrough-class', () => ({
  useSplitGridPassthroughClass: () => ({
    isSplitGridPassthrough: false,
    splitGridPassthroughClass: '',
  }),
}));

vi.mock('@/pages/Home/use-home-chat-entry-send', () => ({
  useHomeChatEntrySend: () => ({
    handleHubSend,
  }),
}));

describe('Home skill seed', () => {
  beforeEach(() => {
    observedSeeds.length = 0;
    cleanupEmptySession.mockClear();
    handleHubSend.mockClear();
    configureWorkflowRunSession.mockReset().mockResolvedValue('test-model');
    navigateToQuery = undefined;
    useAgentEnginePolicyStore.setState({
      engines: [
        { code: 'pi', name: 'SAgent', order: 10 },
        { code: 'claude', name: 'Claude', order: 20 },
      ],
      defaultEngine: 'pi',
      loading: false,
      loaded: true,
      ownerCode: 'current-user',
      configVersion: 'home-workflow-test',
    });
  });

  it('consumes the skill query seed after removing it from the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/?skill=skill-a']}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(observedSeeds).toContain('skill-a');
      expect(observedSeeds.at(-1)).toBeUndefined();
    });
  });

  it('preserves legacy query sending after consuming the skill seed', async () => {
    render(
      <MemoryRouter initialEntries={['/?skill=skill-a']}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(observedSeeds.at(-1)).toBeUndefined();
      expect(navigateToQuery).toBeTypeOf('function');
    });

    act(() => navigateToQuery?.());

    await waitFor(() => {
      expect(handleHubSend).toHaveBeenCalledWith(
        'legacy-query',
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  it('auto-sends workflow run-now pure ?q= on a fresh Home mount', async () => {
    const prompt = '帮我执行 id 为：wf-1 的工作流 【客户异常监控】';
    render(
      <MemoryRouter initialEntries={[`/?q=${encodeURIComponent(prompt)}`]}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(handleHubSend).toHaveBeenCalledWith(
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  it('carries the explicit run-now engine into the workflow send', async () => {
    const prompt = '帮我执行 id 为：wf-1 的工作流 【客户异常监控】';
    render(
      <MemoryRouter initialEntries={[
        `/?q=${encodeURIComponent(prompt)}&workflowRun=1&workflowEngine=claude`,
      ]}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(configureWorkflowRunSession).toHaveBeenCalledWith({
        sessionKey: 'agent:main:session-workflow',
        agentId: 'main',
        engineType: 'claude',
      });
      expect(handleHubSend).toHaveBeenCalledWith(
        prompt,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { workflowExecutionEngine: 'claude' },
      );
    });
  });

  it('auto-sends ?q= with workflowId for official install deep links', async () => {
    render(
      <MemoryRouter initialEntries={['/?q=%2Fdemo&workflowId=tpl_1']}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(handleHubSend).toHaveBeenCalledWith(
        '/demo',
        undefined,
        undefined,
        undefined,
        'tpl_1',
      );
    });
  });
});
