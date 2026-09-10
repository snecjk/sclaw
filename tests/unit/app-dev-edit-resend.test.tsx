import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatDisplayItem } from '@/pages/Chat/chat-display';

/**
 * P1 交互改造 T05：用户消息编辑重发。
 * - ChatStaticItemsList 新增 enableEditMessage，放开 home 变体的编辑入口（缺省行为不变）
 * - 建站工作台点击「编辑」→ 文本回填 composer（复用 composerSeed），改完手动重发
 */

const mocks = vi.hoisted(() => ({
  userMessage: {
    id: 'u1',
    role: 'user',
    content: '  把标题改成蓝色  ',
    timestamp: 1_700_000_000_000,
  },
  turnUserMessage: {
    id: 'u2',
    role: 'user',
    content: '加一个搜索框',
    timestamp: 1_700_000_001_000,
  },
}));

// 消息组件 mock：把 onEditMessage 入口暴露为可点击按钮，便于验证变体判定与回填链路
vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: ({ message, onEditMessage }: {
    message: { id: string; content?: unknown };
    onEditMessage?: (text: string) => void;
  }) => (
    <div data-testid={`chat-message-${message.id}`}>
      {onEditMessage ? (
        <button
          type="button"
          onClick={() => onEditMessage(typeof message.content === 'string' ? message.content : '')}
        >
          编辑
        </button>
      ) : (
        <span>无编辑入口</span>
      )}
    </div>
  ),
}));

vi.mock('@/pages/Chat/AssistantTurnMessage', () => ({
  AssistantTurnMessage: ({ precedingUserMessage, onEditMessage }: {
    precedingUserMessage?: { content?: unknown } | null;
    onEditMessage?: (text: string) => void;
  }) => (
    <div data-testid="assistant-turn-message">
      {onEditMessage ? (
        <button
          type="button"
          onClick={() => onEditMessage(
            typeof precedingUserMessage?.content === 'string' ? precedingUserMessage.content : '',
          )}
        >
          编辑
        </button>
      ) : (
        <span>无编辑入口</span>
      )}
    </div>
  ),
}));

// react-virtual 在测试环境会解析到第二个 React 副本（pnpm 虚拟目录），直接 mock 掉
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

// ── 工作台面板脚手架 mock（沿用 app-dev-preview-error-manual-repair 模式）──

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ workspaceId: 'ws-1' }),
}));

vi.mock('@/stores/chat', () => {
  const useChatStore = Object.assign(
    vi.fn((selector: (state: Record<string, unknown>) => unknown) => selector({
      showThinking: false,
      clearError: vi.fn(),
    })),
    { getState: () => ({ sendMessage: vi.fn(), loadOlderHistory: vi.fn() }) },
  );
  return { useChatStore };
});

vi.mock('@/stores/chat/display-selectors', () => ({
  useSessionDisplayMessages: () => [mocks.userMessage],
  useCurrentChatDisplayMessageCount: () => 1,
}));

vi.mock('@/stores/chat/runtime-selectors', () => ({
  useChatSessionRuntimeView: () => ({
    sending: false,
    pendingFinal: false,
    streamingMessages: [],
    streamingToolResults: [],
    streamingTools: [],
  }),
  useChatSessionSending: () => false,
}));

vi.mock('@/stores/session-catalog', () => ({
  useSessionCatalogStore: (selector: (state: { workspaces: Array<{ id: string; name: string }> }) => unknown) => (
    selector({ workspaces: [{ id: 'ws-1', name: '测试应用' }] })
  ),
}));

vi.mock('@/stores/app-dev-catalog', () => ({
  useAppDevCatalogStore: (selector: (state: { apps: unknown[] }) => unknown) => selector({ apps: [] }),
}));

vi.mock('@/stores/app-plaza-shell', () => ({
  useAppPlazaShellStore: (selector: (state: { closeDevAppTab: () => void }) => unknown) => (
    selector({ closeDevAppTab: vi.fn() })
  ),
}));

vi.mock('@/hooks/use-app-dev-chat-session', () => ({
  useAppDevChatSession: () => 'agent:app-dev:ws-1',
}));

vi.mock('@/hooks/use-app-dev-run-control', () => ({
  useAppDevRunControl: () => ({
    pending: false,
    previewRevision: 0,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    interceptRestartIntent: vi.fn(() => false),
  }),
}));

vi.mock('@/hooks/use-app-dev-status-poll', () => ({
  useAppDevStatusPoll: vi.fn(),
}));

vi.mock('@/hooks/use-sto-app-deploy', () => ({
  useStoAppDeploy: () => ({ running: false, history: [] }),
}));

vi.mock('@/hooks/use-app-dev-ide-ownership', () => ({
  useAppDevIdeOwnership: () => ({ open: false, ready: true }),
  openAppDevIdeWindow: vi.fn(),
}));

vi.mock('@/hooks/use-app-dev-version-restore', () => ({
  useAppDevVersionRestore: () => ({ target: null, confirm: vi.fn(), cancel: vi.fn() }),
}));

vi.mock('@/hooks/use-chat-session-engine-type', () => ({
  useChatSessionEngineType: () => 'openclaw',
}));

vi.mock('@/lib/app-dev-api', () => ({
  createAppCheckpoint: vi.fn().mockResolvedValue(undefined),
  continueStoAppMerge: vi.fn(),
  drainAppErrors: vi.fn().mockResolvedValue([]),
  getAppDevEnvironment: vi.fn().mockResolvedValue({ gitAvailable: false }),
  getStoAppStatus: vi.fn().mockResolvedValue(null),
  pullStoApp: vi.fn(),
  publishAppTemplateWorkspace: vi.fn(),
  pushStoApp: vi.fn(),
  restoreAppCheckpoint: vi.fn(),
}));

// useChatDisplay 固定返回一条用户消息，聚焦 T05 编辑回填链路
vi.mock('@/pages/Chat/use-chat-display', () => ({
  useChatDisplay: () => ({
    staticItems: [{ type: 'single', message: mocks.userMessage, key: 'u1' }],
    activeTurn: null,
  }),
}));

vi.mock('@/components/app-dev/AppDevComposer', () => ({
  AppDevComposer: ({ seedText }: { seedText?: string }) => (
    <div data-testid="workbench-composer">{seedText ?? ''}</div>
  ),
}));

vi.mock('@/components/app-dev/AppDevSplitBody', () => ({
  AppDevSplitBody: ({ chat, children }: { chat?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      {chat}
      {children}
    </div>
  ),
}));

vi.mock('@/components/app-dev/AppDevWorkbenchStage', () => ({
  AppDevWorkbenchStage: () => null,
}));
vi.mock('@/components/app-dev/StoAppCommitDialog', () => ({ StoAppCommitDialog: () => null }));
vi.mock('@/components/app-dev/StoAppDeployControl', () => ({ StoAppDeployControl: () => null }));
vi.mock('@/components/app-dev/StoAppDeployDialog', () => ({ StoAppDeployDialog: () => null }));
vi.mock('@/components/app-dev/StoAppMenuPublishDialog', () => ({ StoAppMenuPublishDialog: () => null }));
vi.mock('@/components/app-dev/AppDevPageTypeBadge', () => ({ AppDevPageTypeBadge: () => null }));
vi.mock('@/components/app-dev/AppDevRunStatusMenu', () => ({ AppDevRunStatusMenu: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/more-apps/TemplatePublishConfirmDialog', () => ({ TemplatePublishConfirmDialog: () => null }));
vi.mock('@/components/more-apps/TemplateProjectUploadControl', () => ({ TemplateProjectUploadControl: () => null }));
vi.mock('@/components/more-apps/BuiltinTemplateDebugControl', () => ({ BuiltinTemplateDebugControl: () => null }));

import { ChatStaticItemsList, type ChatStaticItemsListProps } from '@/components/chat/ChatStaticItemsList';
import { AppPlazaDevAppPane } from '@/components/more-apps/AppPlazaDevAppPane';

// jsdom 无 ResizeObserver（ChatStaticItemsList 历史加载监听需要）
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

function renderStaticList(props: {
  variant: 'page' | 'home' | 'embed';
  onEditMessage?: (text: string) => void;
  enableEditMessage?: boolean;
  items?: ChatDisplayItem[];
}) {
  const scrollRef = createRef<HTMLDivElement>();
  const listProps: ChatStaticItemsListProps = {
    items: props.items ?? [{ type: 'single', message: mocks.userMessage as never, key: 'u1' }],
    messages: [mocks.userMessage as never],
    showThinking: false,
    scrollRef,
    variant: props.variant,
    onEditMessage: props.onEditMessage as never,
    enableEditMessage: props.enableEditMessage,
  };
  return render(<ChatStaticItemsList {...listProps} />);
}

describe('ChatStaticItemsList 编辑入口（T05 enableEditMessage）', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('home 变体 + enableEditMessage：用户消息出现编辑入口，点击回调消息文本', () => {
    const onEditMessage = vi.fn();
    renderStaticList({ variant: 'home', onEditMessage, enableEditMessage: true });

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    expect(onEditMessage).toHaveBeenCalledTimes(1);
    expect(onEditMessage).toHaveBeenCalledWith('  把标题改成蓝色  ');
  });

  it('home 变体缺省不放开编辑（现有行为不变）', () => {
    const onEditMessage = vi.fn();
    renderStaticList({ variant: 'home', onEditMessage });

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.getByText('无编辑入口')).toBeInTheDocument();
    expect(onEditMessage).not.toHaveBeenCalled();
  });

  it('page 变体（主会话）不传 enableEditMessage 行为不变：仍有编辑入口', () => {
    const onEditMessage = vi.fn();
    renderStaticList({ variant: 'page', onEditMessage });

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    expect(onEditMessage).toHaveBeenCalledTimes(1);
  });

  it('embed 变体不放开编辑', () => {
    const onEditMessage = vi.fn();
    renderStaticList({ variant: 'embed', onEditMessage });

    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  it('assistant-turn 项同样按 enableEditMessage 透传（工作台多轮对话形态）', () => {
    const onEditMessage = vi.fn();
    const turnItems: ChatDisplayItem[] = [{
      type: 'assistant-turn',
      messages: [{ id: 'a1', role: 'assistant', content: '已完成' } as never],
      toolResults: [],
      precedingUserMessage: mocks.turnUserMessage as never,
      key: 'turn-user-u2',
    }];
    renderStaticList({ variant: 'home', onEditMessage, enableEditMessage: true, items: turnItems });

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));

    expect(onEditMessage).toHaveBeenCalledWith('加一个搜索框');
  });
});

describe('建站工作台编辑重发回填链路', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('点击用户消息「编辑」→ 文本去空白回填 composer，等待用户改完手动重发', async () => {
    render(
      <AppPlazaDevAppPane
        tab={{ id: 'tab-1', kind: 'app', workspaceId: 'ws-1', title: '测试应用' }}
        active
      />,
    );

    // 初始 composer 为空
    expect(screen.getByTestId('workbench-composer')).toHaveTextContent('');

    fireEvent.click(await screen.findByRole('button', { name: '编辑' }));

    // 回填 composerSeed（首尾空白被 trim），用户可在 composer 中修改后重新发送
    expect(screen.getByTestId('workbench-composer')).toHaveTextContent('把标题改成蓝色');
  });
});
