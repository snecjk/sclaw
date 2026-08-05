import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorCard } from '@/components/connectors/ConnectorCard';
import type { ConnectorViewItem } from '../../shared/connectors/types';

const newSession = vi.fn();
const toastMessage = vi.fn();

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => ({
      sessions: [],
      sessionLabels: {},
      sessionLastActivity: {},
      currentSessionKey: 'agent:main:session-new',
      switchSession: vi.fn(),
      newSession,
      renameSession: vi.fn(),
    }),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: (...args: unknown[]) => toastMessage(...args),
  },
}));

const multilinePrompt = '帮我查询钉钉通讯录\n第二行：统计「研发部」人数';

function makeItem(overrides: Partial<ConnectorViewItem> = {}): ConnectorViewItem {
  return {
    id: 'conn-dingtalk',
    name: '钉钉',
    description: '钉钉 CLI 描述',
    iconUrl: '',
    kind: 'managed_cli',
    order: 10,
    badge: '',
    minClientVersion: '',
    runtime: { binary: 'dws' },
    agent: { summary: '通讯录、发消息' },
    localStatus: 'connected',
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  const state = (location.state ?? null) as { mainChatDraft?: string; mainChatDraftToken?: string } | null;
  return (
    <div>
      <div data-testid="probe-pathname">{location.pathname}</div>
      <div data-testid="probe-search">{location.search}</div>
      <div data-testid="probe-draft">{state?.mainChatDraft ?? ''}</div>
      <div data-testid="probe-token">{state?.mainChatDraftToken ?? ''}</div>
    </div>
  );
}

function renderCard(item: ConnectorViewItem) {
  return render(
    <MemoryRouter initialEntries={['/skills']}>
      <LocationProbe />
      <ConnectorCard
        item={item}
        busy={false}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function openConnectedDetail() {
  fireEvent.click(screen.getByTitle('查看详情'));
  return screen.getByRole('button', { name: '去试试' });
}

describe('ConnectorCard 去试试', () => {
  beforeEach(() => {
    newSession.mockClear();
    toastMessage.mockClear();
  });

  it('closes the detail modal and seeds a new session draft via router state (not ?q=)', () => {
    renderCard(makeItem({ prompt: multilinePrompt }));
    const tryButton = openConnectedDetail();

    fireEvent.click(tryButton);

    // 弹窗关闭：「去试试」按钮随之卸载
    expect(screen.queryByRole('button', { name: '去试试' })).toBeNull();
    // 新建空会话
    expect(newSession).toHaveBeenCalledTimes(1);
    // 导航到主聊天首页，草稿经一次性 router state 传递，不走 ?q= 自动发送链路
    expect(screen.getByTestId('probe-pathname').textContent).toBe('/');
    expect(screen.getByTestId('probe-search').textContent).toBe('');
    expect(screen.getByTestId('probe-draft').textContent).toBe(multilinePrompt);
    expect(screen.getByTestId('probe-token').textContent).not.toBe('');
  });

  it('disables 去试试 when the catalog item has no prompt (older server)', () => {
    renderCard(makeItem({ prompt: undefined }));
    const tryButton = openConnectedDetail();

    expect(tryButton).toBeDisabled();
    expect(tryButton).toHaveAttribute('title', '暂无试用提示词');

    fireEvent.click(tryButton);

    // 禁用态不产生导航副作用
    expect(newSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe-pathname').textContent).toBe('/skills');
    expect(screen.getByTestId('probe-draft').textContent).toBe('');
  });

  it('does not fall back to description or summary as the trial prompt', () => {
    renderCard(makeItem({ prompt: '  \n ', description: '钉钉 CLI 描述' }));
    const tryButton = openConnectedDetail();

    expect(tryButton).toBeDisabled();
    expect(screen.getByTestId('probe-draft').textContent).toBe('');
  });
});
