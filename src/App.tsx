/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Models } from './pages/Models';
import { Chat } from './pages/Chat';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Subscriptions } from './pages/Subscriptions';
import { Cron } from './pages/Cron';
import { Home } from './pages/Home';
import { TaskDetail } from './pages/TaskDetail';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Login } from './pages/Login';
import { Sprite } from './pages/Sprite';
import { FloatIcon } from './pages/FloatIcon';
import { useSettingsStore } from './stores/settings';
import { useAuthStore } from './stores/auth';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { useChatStore } from './stores/chat';
import { applyGatewayTransportPreference, invokeIpc } from './lib/api-client';


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#f87171',
          background: '#0f172a',
          minHeight: '100vh',
          fontFamily: 'monospace'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Something went wrong</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: '#1e293b',
            padding: '16px',
            borderRadius: '8px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
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
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isAuthInitialized = useAuthStore((state) => state.isInitialized);
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

  // Auth guard: redirect to login if not authenticated, then to setup if not complete
  // Skip auth guard for sprite and float-icon routes (they manage their own initialization)
  // Also skip until isAuthInitialized is true — this prevents the persisted isAuthenticated=true
  // from bypassing login on reinstall before the main-process token-expiry check completes.
  useEffect(() => {
    if (location.pathname === '/sprite' || location.pathname === '/float-icon') return;
    if (!isAuthInitialized) return;
    if (!isAuthenticated && !location.pathname.startsWith('/login')) {
      navigate('/login');
    } else if (isAuthenticated && location.pathname.startsWith('/login')) {
      // Logged in — leave the login page
      navigate(setupComplete ? '/' : '/setup');
    } else if (isAuthenticated && !setupComplete && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [isAuthenticated, isAuthInitialized, setupComplete, location.pathname, navigate]);

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
    };

    const unsubscribe = window.electron.ipcRenderer.on('auth:token-expired', handleTokenExpired);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

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
      <TooltipProvider delayDuration={300}>
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
            <Route path="/chat" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/settings/*" element={<Settings />} />
          </Route>
        </Routes>

        {/* Global toast notifications（悬浮图标窗体极小，不挂载 Toaster 以免撑开文档） */}
        {location.pathname !== '/float-icon' ? (
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            style={{ zIndex: 99999 }}
          />
        ) : null}
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
