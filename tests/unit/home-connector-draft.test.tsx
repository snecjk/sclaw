import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Home } from '@/pages/Home';

const observedSeeds: Array<string | undefined> = [];
const observedStates: Array<unknown> = [];
const cleanupEmptySession = vi.fn();
const handleHubSend = vi.fn();
const handleHubQueue = vi.fn();

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
  HomeAgentHubSurface: ({ seedText }: { seedText?: string; seedSkillSlug?: string }) => {
    const location = useLocation();
    observedSeeds.push(seedText);
    observedStates.push(location.state);
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
    handleHubQueue,
  }),
}));

const draftText = '帮我查询钉钉通讯录\n第二行：统计「研发部」人数';
const draftEntry = {
  pathname: '/',
  state: { mainChatDraft: draftText, mainChatDraftToken: 'draft-test-1' },
};

describe('Home connector draft consumption (去试试)', () => {
  beforeEach(() => {
    observedSeeds.length = 0;
    observedStates.length = 0;
    cleanupEmptySession.mockClear();
    handleHubSend.mockClear();
    handleHubQueue.mockClear();
  });

  it('seeds the draft once, clears the route state, and never auto-sends', async () => {
    const view = render(
      <MemoryRouter initialEntries={[draftEntry]}>
        <Home />
      </MemoryRouter>,
    );

    // 草稿交给现有 seedText 链路
    await waitFor(() => {
      expect(observedSeeds).toContain(draftText);
    });

    // 消费后立即清理路由 state：后续渲染 seedText 回到 undefined
    await waitFor(() => {
      expect(observedSeeds.at(-1)).toBeUndefined();
      expect(observedStates.at(-1)).toBeNull();
    });

    // 绝不自动发送：不产生用户消息 / Agent 请求
    expect(handleHubSend).not.toHaveBeenCalled();
    expect(handleHubQueue).not.toHaveBeenCalled();

    view.unmount();
  });

  it('does not re-seed after consumption (refresh/back-safe one-shot draft)', async () => {
    // 与真实场景一致：草稿消费后路由 state 已被 replace 清除，
    // 刷新等价于在同一路由上重新挂载 Home。
    const router = render(
      <MemoryRouter initialEntries={[draftEntry]}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(observedSeeds.at(-1)).toBeUndefined();
      expect(observedStates.at(-1)).toBeNull();
    });

    router.unmount();

    // 模拟刷新：同一路由（state 已清空）重新挂载
    render(
      <MemoryRouter initialEntries={[{ pathname: '/' }]}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(observedStates.at(-1)).toBeNull();
    });

    // 草稿只被消费一次：重新挂载后没有任何 seedText 下发
    expect(observedSeeds.filter((seed) => seed === draftText)).toHaveLength(1);
    expect(observedSeeds.at(-1)).toBeUndefined();
    expect(handleHubSend).not.toHaveBeenCalled();
  });
});
