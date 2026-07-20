import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '@/pages/Home';

const observedSeeds: Array<string | undefined> = [];
const cleanupEmptySession = vi.fn();
const handleHubSend = vi.fn();
let navigateToQuery: (() => void) | undefined;

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    user: null,
    isAuthenticated: false,
    siteDepartmentTypes: [],
  }),
  isSiteUser: () => false,
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    cleanupEmptySession,
    currentSessionKey: 'agent:main:main',
    messages: [],
    sending: false,
    pendingFinal: false,
    streamingMessage: null,
    streamingText: '',
    streamingTools: [],
  }),
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

vi.mock('@/hooks/use-builtin-tool-listener', () => ({
  useBuiltinToolListener: () => {},
}));

vi.mock('@/pages/ScheduledTasks/components/TaskCreateModal', () => ({
  TaskCreateModal: () => null,
}));

describe('Home skill seed', () => {
  beforeEach(() => {
    observedSeeds.length = 0;
    cleanupEmptySession.mockClear();
    handleHubSend.mockClear();
    navigateToQuery = undefined;
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
