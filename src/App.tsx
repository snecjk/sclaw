/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster, toast } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { AppShellLayoutProvider, useAppShellLayout } from '@/components/layout/app-shell-layout-context';
import { computeToastLayoutOffsetPx } from '@/lib/app-shell-metrics';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Models } from './pages/Models';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { SkillPlazaPage } from './components/skill-plaza/SkillPlazaPage';
import { AppPlazaRouteSlot } from './components/more-apps/AppPlazaShell';
import { Subscriptions } from './pages/Subscriptions';
import MyTask from './pages/MyTask';
import { Home } from './pages/Home';
import { TaskDetail } from './pages/TaskDetail';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Sprite } from './pages/Sprite';
import { FloatIcon } from './pages/FloatIcon';
import { WorkflowTestPage } from './pages/Workflow';
import { DataCenter } from './pages/DataCenter';
import { ReportHistoryPage } from './pages/DataCenter/reports/ReportHistoryPage';
import { TutorialDetailPage } from './pages/LearningCenter/TutorialDetailPage';
import { LearningCenterPage } from './pages/LearningCenter/LearningCenterPage';
import { useSettingsStore } from './stores/settings';
import { useAuthStore } from './stores/auth';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useAgentsStore } from './stores/agents';
import { useChatStore } from './stores/chat';
import { applyGatewayTransportPreference, invokeIpc } from './lib/api-client';
import { UserWatermark } from './components/layout/UserWatermark';
import { WorkflowCompletionNotifier } from './components/workflow/WorkflowCompletionNotifier';
import { JsBridgeHostPortal } from './components/jsbridge/JsBridgeHostPortal';
import { ThemeController } from './components/theme/ThemeController';

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null; componentStack: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '40px',
            color: '#f87171',
            background: '#0d0d0d',
            minHeight: '100vh',
            fontFamily: 'monospace',
          }}
        >
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: '#212121',
              padding: '16px',
              borderRadius: '8px',
              fontSize: '14px',
            }}
          >
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
            {this.state.componentStack ? `\n\nReact component stack:\n${this.state.componentStack}` : ''}
          </pre>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null, componentStack: null });
              window.location.reload();
            }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
  const accessDenied = useAuthStore((state) => state.accessDenied);
  const initAuth = useAuthStore((state) => state.init);

  useEffect(() => {
    initSettings();
    initAuth();
  }, [initSettings, initAuth]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  // Initialize agents data on mount
  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  // Auth guard: redirect to login if not authenticated, then to setup if not complete
  // Skip auth guard for sprite and float-icon routes (they manage their own initialization)
  // Also skip until isAuthInitialized is true — this prevents the persisted isAuthenticated=true
  // from bypassing login on reinstall before the main-process token-expiry check completes.
  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return;
    if (!isAuthInitialized) return;
    if (accessDenied && !location.pathname.startsWith('/login')) {
      navigate('/login');
      return;
    }
    if (!isAuthenticated && !location.pathname.startsWith('/login')) {
      navigate('/login');
    } else if (isAuthenticated && location.pathname.startsWith('/login')) {
      // Logged in — leave the login page
      navigate(setupComplete ? '/' : '/setup');
    } else if (isAuthenticated && !setupComplete && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [
    isAuthenticated,
    isAuthInitialized,
    accessDenied,
    setupComplete,
    location.pathname,
    navigate,
  ]);

  // Listen for navigation events from main process
  useEffect(() => {
    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = window.electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Listen for token-expired event from main process.
  // When StoToken expires, clear renderer auth state so the auth guard
  // automatically redirects to the login page.
  useEffect(() => {
    const handleTokenExpired = () => {
      useAuthStore.setState({
        isAuthenticated: false,
        user: null,
      });
      // Clear both top-level and session-level chat errors so the error bar
      // doesn't persist after re-login
      useChatStore.getState().clearError();
    };

    const unsubscribe = window.electron.ipcRenderer.on('auth:token-expired', handleTokenExpired);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // STO catalog sync (login / periodic / manual) → refresh toolbar default model
  useEffect(() => {
    const handleStoModelsSynced = (...args: unknown[]) => {
      const payload = args[0] as { fallbackModel?: string } | undefined;
      void import('@/lib/sync-workspace-default-to-chat').then(({ applyStoCatalogSyncToChatUi }) => (
        applyStoCatalogSyncToChatUi({ fallbackModel: payload?.fallbackModel })
      ));
    };

    const unsubscribe = window.electron.ipcRenderer.on('sto:models-synced', handleStoModelsSynced);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Listen for SAI CLI install failure and prompt user to retry
  useEffect(() => {
    const handleSaiCliInstallFailed = (...args: unknown[]) => {
      const errorMsg = typeof args[0] === 'string' ? args[0] : 'SAI CLI 安装失败';
      toast.error('SAI CLI 安装失败', {
        description: errorMsg,
        duration: 0,
        action: {
          label: '一键安装',
          onClick: async () => {
            const result = (await invokeIpc('sai.install')) as
              | { success?: boolean; path?: string; error?: string }
              | undefined;
            if (result?.success) {
              toast.success('SAI CLI 安装成功', { description: result.path });
            } else {
              toast.error('SAI CLI 安装失败', { description: result?.error || '未知错误' });
            }
          },
        },
      });
    };

    const unsubscribe = window.electron.ipcRenderer.on(
      'sai:cli-install-failed',
      handleSaiCliInstallFailed
    );

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  // Push current session context to main process for the sprite window.
  // Only runs in the main window (not in the sprite route).
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return;
    invokeIpc('sprite:pushSessionContext', {
      sessionKey: currentSessionKey,
      agentId: currentAgentId,
    });
  }, [currentSessionKey, currentAgentId, location.pathname]);

  return (
    <ErrorBoundary>
      <ThemeController>
        <TooltipProvider delayDuration={300}>
          <AppShellLayoutProvider>
            <WorkflowCompletionNotifier />
            <Routes>
            {/* SSO Login page */}
            <Route path="/login" element={<Login />} />

            {/* Setup wizard (shown on first launch) */}
            <Route path="/setup/*" element={<Setup />} />

            {/* Desktop sprite (floating assistant window) */}
            <Route path="/sprite" element={<Sprite />} />

            {/* Desktop float icon (floating launcher) */}
            <Route path="/float-icon" element={<FloatIcon />} />

            {/* Main application routes */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/tasks/:taskId/:entryId" element={<TaskDetail />} />
              <Route path="/tasks/:taskId" element={<TaskDetail />} />
              <Route path="/chat" element={<Navigate to="/" replace />} />
              <Route path="/models" element={<Models />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/skills" element={<SkillPlazaPage />} />
              <Route path="/more-apps" element={<AppPlazaRouteSlot />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/my-tasks" element={<MyTask />} />
              <Route path="/data-center" element={<DataCenter />} />
              <Route path="/data-center/reports/history" element={<ReportHistoryPage />} />
              <Route path="/learning-center" element={<LearningCenterPage />} />
              <Route path="/learning-center/tutorial/:tutorialId" element={<TutorialDetailPage />} />
              <Route path="/workflow/*" element={<WorkflowTestPage />} />
              <Route path="/settings/*" element={<Settings />} />
            </Route>
            </Routes>

            {/* Global toast notifications（悬浮图标窗体极小，不挂载 Toaster 以免撑开文档） */}
            {location.pathname !== '/float-icon' ? <AppShellToaster /> : null}
            <JsBridgeHostPortal />
            {location.pathname !== '/float-icon' && location.pathname !== '/sprite' ? (
              <UserWatermark />
            ) : null}
          </AppShellLayoutProvider>
        </TooltipProvider>
      </ThemeController>
    </ErrorBoundary>
  );
}

/** Toaster reads AppShell effective width — no hard-coded 72/260. */
function AppShellToaster() {
  const { snapshot } = useAppShellLayout();
  const toastOffsetPx = computeToastLayoutOffsetPx(snapshot);
  const toastCenterX = `calc(50% + ${toastOffsetPx / 2}px)`;

  return (
    <Toaster
      className="sto-global-toaster"
      position="top-center"
      richColors
      offset={23}
      gap={12}
      visibleToasts={3}
      style={{
        left: toastCenterX,
        right: 'auto',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        // Radix modal drawers disable pointer events on `body`. The global
        // toaster sits outside their dismissable layer, so it must opt back
        // in or the first click only dismisses the drawer beneath it.
        pointerEvents: 'auto',
      }}
    />
  );
}

export default App;
