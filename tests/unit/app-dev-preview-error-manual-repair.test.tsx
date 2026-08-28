import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

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
    { getState: () => ({ sendMessage: mocks.sendMessage }) },
  );
  return { useChatStore };
});

vi.mock('@/stores/chat/display-selectors', () => ({
  useSessionDisplayMessages: () => [],
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

vi.mock('@/stores/more-apps', () => ({
  useMoreAppsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({}),
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
  useStoAppDeploy: () => ({ job: null, clear: vi.fn(), deploy: vi.fn() }),
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

vi.mock('@/components/app-dev/AppDevSplitBody', () => ({
  AppDevSplitBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/app-dev/AppDevWorkbenchStage', () => ({
  AppDevWorkbenchStage: ({
    pendingErrors,
    onPreviewRuntimeError,
  }: {
    pendingErrors: string[];
    onPreviewRuntimeError: (error: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onPreviewRuntimeError('runtime boom')}>触发预览错误</button>
      <output>{pendingErrors.join('\n')}</output>
    </div>
  ),
}));

vi.mock('@/components/app-dev/StoAppCommitDialog', () => ({ StoAppCommitDialog: () => null }));
vi.mock('@/components/app-dev/StoAppDeployControl', () => ({ StoAppDeployControl: () => null }));
vi.mock('@/components/app-dev/StoAppDeployDialog', () => ({ StoAppDeployDialog: () => null }));
vi.mock('@/components/app-dev/AppDevPageTypeBadge', () => ({ AppDevPageTypeBadge: () => null }));
vi.mock('@/components/app-dev/AppDevRunStatusMenu', () => ({ AppDevRunStatusMenu: () => null }));
vi.mock('@/components/ui/confirm-dialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/more-apps/TemplatePublishConfirmDialog', () => ({ TemplatePublishConfirmDialog: () => null }));
vi.mock('@/components/more-apps/TemplateProjectUploadControl', () => ({ TemplateProjectUploadControl: () => null }));
vi.mock('@/stores/chat/chat-flow-log', () => ({ logChatFlow: vi.fn() }));
vi.mock('@/stores/chat/session-identity', () => ({ getAgentIdFromSessionKey: () => 'app-dev' }));

import AppDevWorkbench from '@/pages/AppDev/AppDevWorkbench';
import { AppPlazaDevAppPane } from '@/components/more-apps/AppPlazaDevAppPane';

describe('app development preview error repair', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['legacy workbench', AppDevWorkbench, {}],
    ['app plaza workbench', AppPlazaDevAppPane, {
      tab: { id: 'tab-1', kind: 'app', workspaceId: 'ws-1', title: '测试应用' },
      active: true,
    }],
  ] as const)('keeps %s preview failures visible without automatically messaging AI', async (_name, Component, props) => {
    render(<Component {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '触发预览错误' }));

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(screen.getByText('runtime boom')).toBeInTheDocument();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
