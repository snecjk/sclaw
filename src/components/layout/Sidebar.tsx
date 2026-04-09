/**
 * Sidebar Component
 * Narrow icon rail + optional chat panel (new session + history) to the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  Plus,
  Trash2,
  LogOut,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useAuthStore } from '@/stores/auth';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

/** 本次渲染进程内是否已完成「首次进入对话页」的新会话（避免先打开其它页再点对话仍落在旧会话上） */
let didBootstrapFreshChat = false;

const RAIL_WIDTH_CLASS = 'w-[5.25rem]';
/** Open width of the chat history column (narrower than before for less visual weight) */
const HISTORY_PANEL_WIDTH_CLASS = 'w-[12rem]';

/** Smooth bump along the seam: straight vertical at x=0, quadratic arc outward (matches h-20 = 80px). */
const HISTORY_EDGE_CLIP_PATH =
  'path("M 0 0 L 0 80 Q 48 40 0 0 Z")' as const;

const historyEdgeArcClipStyle: CSSProperties = {
  clipPath: HISTORY_EDGE_CLIP_PATH,
  WebkitClipPath: HISTORY_EDGE_CLIP_PATH,
};

interface RailNavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

function RailNavItem({ to, icon, label, end, onClick }: RailNavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'relative mx-1 flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 transition-all duration-300 ease-out',
          'border border-transparent text-foreground/75 hover:bg-primary/[0.06] hover:text-foreground',
          'active:scale-[0.97]',
          isActive && 'border-primary/15 bg-primary/[0.1] text-foreground shadow-[0_8px_20px_rgba(14,165,233,0.08)]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1/2 h-10 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_14px_rgba(56,189,248,0.75)]" />
          )}
          <div className={cn('flex shrink-0 items-center justify-center', isActive ? 'text-foreground' : 'text-muted-foreground')}>
            {icon}
          </div>
          <span className="max-w-[5rem] text-center text-[13px] font-medium leading-snug line-clamp-2">
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

const INITIAL_NOW_MS = Date.now();

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const authUser = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);

  const location = useLocation();
  const [chatPanelOpen, setChatPanelOpen] = useState(() => location.pathname === '/');
  /** 登录后进对话页：历史会话列表默认收起，需点边缘钮或再点「对话」展开 */
  const [historyPanelCollapsed, setHistoryPanelCollapsed] = useState(true);
  const prevPathRef = useRef<string | null>(null);

  useEffect(() => {
    const cur = location.pathname;
    const prev = prevPathRef.current;
    prevPathRef.current = cur;

    if (cur !== '/') {
      setChatPanelOpen(false);
      return;
    }
    if (prev !== null && prev !== '/') {
      setChatPanelOpen(true);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    (async () => {
      await loadSessions();
      if (cancelled) return;

      if (location.pathname !== '/') {
        const hasExistingMessages = useChatStore.getState().messages.length > 0;
        await loadHistory(hasExistingMessages);
        return;
      }

      // 首次进入 /（含：启动先进其它页再点「对话」）：始终新开一条会话，不再依赖「当时 messages 是否为空」
      if (!didBootstrapFreshChat) {
        didBootstrapFreshChat = true;
        newSession();
        await loadHistory(false);
        return;
      }

      const hasExistingMessages = useChatStore.getState().messages.length > 0;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions, location.pathname, newSession]);

  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  const navigate = useNavigate();
  const isOnChat = location.pathname === '/';

  const { t } = useTranslation(['common', 'chat', 'auth']);

  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) => {
      const preview = sessionLabels[key];
      if (preview) return preview;
      if (label?.trim()) return label;
      const dn = displayName?.trim();
      if (dn && !looksLikeTechnicalSessionDisplay(dn) && dn !== key) return dn;
      if (key.endsWith(':main')) {
        return t('chat:sessionList.mainSessionTitle');
      }
      return key;
    },
    [sessionLabels, t],
  );
  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameById = useMemo(
    () => Object.fromEntries((agents ?? []).map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> = [
    { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
    { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
    { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
    { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
    { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
    { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
  ];
  const sessionBucketMap = Object.fromEntries(sessionBuckets.map((bucket) => [bucket.key, bucket])) as Record<
    SessionBucketKey,
    (typeof sessionBuckets)[number]
  >;

  const getEffectiveActivityMs = (sessionKey: string): number => {
    const recorded = sessionLastActivity[sessionKey] ?? 0;
    if (recorded > 0) return recorded;
    const isFreshCurrentSession = sessionKey === currentSessionKey && !sessionLabels[sessionKey];
    return isFreshCurrentSession ? nowMs : 0;
  };

  for (const session of [...sessions].sort((a, b) =>
    getEffectiveActivityMs(b.key) - getEffectiveActivityMs(a.key),
  )) {
    const bucketKey = getSessionBucket(getEffectiveActivityMs(session.key), nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const navItems = [
    { to: '/skills', icon: <Puzzle className="h-5 w-5" strokeWidth={2} />, label: t('sidebar.skills') },
    { to: '/cron', icon: <Clock className="h-5 w-5" strokeWidth={2} />, label: t('sidebar.cronTasks') },
  ];

  /**
   * Shared chat strip state machine (对话 + 边缘钮共用).
   * - 全关 → 全开（含历史）
   * - 仅历史收起 → 展开历史
   * - 全开 → 边缘钮：收起历史；对话：整块收起（与原先点对话一致）
   */
  const stepChatSidebar = (source: 'edge' | 'chatNav') => {
    if (!chatPanelOpen) {
      setChatPanelOpen(true);
      setHistoryPanelCollapsed(false);
      return;
    }
    if (historyPanelCollapsed) {
      setHistoryPanelCollapsed(false);
      return;
    }
    if (source === 'chatNav') {
      setChatPanelOpen(false);
    } else {
      setHistoryPanelCollapsed(true);
    }
  };

  const handleChatNavClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === '/') {
      e.preventDefault();
      stepChatSidebar('chatNav');
    }
  };

  const handleChatPanelEdgeToggle = () => {
    stepChatSidebar('edge');
  };

  const showHistoryEdgeToggleOnRail = isOnChat && (!chatPanelOpen || historyPanelCollapsed);
  const showHistoryEdgeToggleOnPanel = isOnChat && chatPanelOpen && !historyPanelCollapsed;

  const historyPanelToggleLabel =
    !chatPanelOpen
      ? t('sidebar.expand')
      : historyPanelCollapsed
        ? t('sidebar.expandHistoryPanel')
        : t('sidebar.collapseHistoryPanel');

  /** Glass + quadratic clip: reads as a soft tab growing out of the panel edge (not a separate block). */
  const historyEdgeArcClass = cn(
    'glass flex h-20 w-[40px] shrink-0 items-center justify-center',
    'border-0 p-0',
    'text-muted-foreground/48',
    'shadow-[2px_0_14px_rgba(15,23,42,0.07)] dark:shadow-[2px_0_18px_rgba(0,0,0,0.35)]',
    'transition-[color,filter,box-shadow] duration-200',
    'hover:text-muted-foreground/82 hover:shadow-[3px_0_18px_rgba(56,189,248,0.1)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0',
    'active:opacity-90',
  );

  const sessionList = (
    <>
      {sessionBuckets.map((bucket) =>
        bucket.sessions.length > 0 ? (
          <div key={bucket.key} className="pt-2">
            <div className="px-2 pb-1 text-[11px] font-medium tracking-tight text-muted-foreground/60">
              {bucket.label}
            </div>
            {bucket.sessions.map((s) => {
              const agentId = getAgentIdFromSessionKey(s.key);
              const agentName = agentNameById[agentId] || agentId;
              return (
                <div key={s.key} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      switchSession(s.key);
                      navigate('/');
                    }}
                    title={getSessionLabel(s.key, s.displayName, s.label)}
                    className={cn(
                      'w-full rounded-xl px-2.5 py-2 pr-7 text-left text-[13px] transition-all duration-300',
                      'border border-transparent hover:border-primary/10 hover:bg-primary/[0.05]',
                      isOnChat && currentSessionKey === s.key
                        ? 'border-primary/15 bg-primary/[0.08] font-medium text-foreground shadow-[0_10px_20px_rgba(56,189,248,0.08)]'
                        : 'text-foreground/75',
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate">{getSessionLabel(s.key, s.displayName, s.label)}</span>
                      <span className="truncate text-[10px] text-muted-foreground/80">{agentName}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={t('common:actions.delete')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionToDelete({
                        key: s.key,
                        label: getSessionLabel(s.key, s.displayName, s.label),
                      });
                    }}
                    className={cn(
                      'absolute right-1 flex items-center justify-center rounded p-0.5 transition-opacity',
                      'opacity-0 group-hover:opacity-100',
                      'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null,
      )}
    </>
  );

  return (
    <div className="flex h-full shrink-0 overflow-visible">
      {/* Narrow rail */}
      <aside
        className={cn(
          'relative flex shrink-0 flex-col overflow-visible border-r glass',
          RAIL_WIDTH_CLASS,
        )}
      >
        {showHistoryEdgeToggleOnRail && (
          <button
            type="button"
            aria-expanded={chatPanelOpen && !historyPanelCollapsed}
            aria-label={historyPanelToggleLabel}
            title={historyPanelToggleLabel}
            onClick={handleChatPanelEdgeToggle}
            style={historyEdgeArcClipStyle}
            className={cn(
              'absolute left-full top-1/2 z-30 -translate-x-1/2 -translate-y-1/2',
              historyEdgeArcClass,
            )}
          >
            <ChevronRight className="relative z-10 h-4 w-4 -translate-x-px" strokeWidth={1.65} />
          </button>
        )}
        <nav className="relative z-10 flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden py-2">
          <RailNavItem
            to="/"
            end
            icon={<MessageSquare className="h-5 w-5" strokeWidth={2} />}
            label={t('sidebar.chat')}
            onClick={handleChatNavClick}
          />
          {navItems.map((item) => (
            <RailNavItem key={item.to} to={item.to} icon={item.icon} label={item.label} />
          ))}
          <RailNavItem
            to="/settings"
            icon={<SettingsIcon className="h-5 w-5" strokeWidth={2} />}
            label={t('sidebar.settings')}
          />
        </nav>

        {authUser && (
          <div className="relative z-10 mt-auto flex flex-col items-center gap-1.5 px-1 pb-2 pt-1">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary"
              title={isGatewayRunning ? t('status.connected') : t('status.disconnected')}
            >
              {authUser.realName?.[0] || authUser.userName?.[0] || '?'}
            </div>
            <span
              className="max-w-full px-0.5 text-center text-[13px] font-medium leading-snug text-foreground/80 line-clamp-2 break-words"
              title={authUser.realName || authUser.userName || undefined}
            >
              {authUser.realName || authUser.userName}
            </span>
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title={t('auth:logout.button')}
            >
              <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
            </button>
          </div>
        )}

        <ConfirmDialog
          open={!!sessionToDelete}
          title={t('common:actions.confirm')}
          message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
          confirmLabel={t('common:actions.delete')}
          cancelLabel={t('common:actions.cancel')}
          variant="destructive"
          onConfirm={async () => {
            if (!sessionToDelete) return;
            await deleteSession(sessionToDelete.key);
            if (currentSessionKey === sessionToDelete.key) navigate('/');
            setSessionToDelete(null);
          }}
          onCancel={() => setSessionToDelete(null)}
        />

        <ConfirmDialog
          open={showLogoutConfirm}
          title={t('auth:logout.confirmTitle')}
          message={t('auth:logout.confirmMessage')}
          confirmLabel={t('auth:logout.button')}
          cancelLabel={t('common:actions.cancel')}
          variant="destructive"
          onConfirm={async () => {
            setShowLogoutConfirm(false);
            await authLogout();
            navigate('/login');
          }}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      </aside>

      {/* Chat column: keep mounted on / so width can animate (对话收起不再整段卸载，避免生硬跳变) */}
      {isOnChat && (
        <div
          className={cn(
            'relative h-full shrink-0 overflow-visible',
            'min-w-0 transition-[width] duration-[420ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
            chatPanelOpen && !historyPanelCollapsed ? HISTORY_PANEL_WIDTH_CLASS : 'w-0',
            (!chatPanelOpen || historyPanelCollapsed) && 'pointer-events-none',
          )}
        >
          <aside
            className={cn(
              'relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden border-r glass',
              !chatPanelOpen || historyPanelCollapsed ? 'border-transparent' : undefined,
            )}
            aria-hidden={!chatPanelOpen || historyPanelCollapsed}
          >
            <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
              <div className="shrink-0 p-2 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    const { messages } = useChatStore.getState();
                    if (messages.length > 0) newSession();
                    navigate('/');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-all duration-300',
                    'border border-primary/15 bg-[linear-gradient(135deg,rgba(125,211,252,0.16),rgba(56,189,248,0.10))] text-foreground shadow-[0_8px_20px_rgba(56,189,248,0.08)] hover:border-primary/25',
                  )}
                >
                  <Plus className="h-[17px] w-[17px] shrink-0" strokeWidth={2} />
                  <span className="truncate text-left">{t('sidebar.newChat')}</span>
                </button>
              </div>
              <div
                className="mx-3 mb-1 mt-0.5 h-px shrink-0 bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.22),hsl(var(--primary)/0.08),transparent)] dark:bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.28),hsl(var(--primary)/0.12),transparent)]"
                role="separator"
                aria-hidden
              />
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-8 pt-2">
                {sessions.length === 0 ? (
                  <p className="px-2 pt-3 text-center text-[12px] leading-relaxed text-muted-foreground/70">
                    {t('sidebar.emptyChatHistory')}
                  </p>
                ) : (
                  sessionList
                )}
              </div>
            </div>
          </aside>
          {showHistoryEdgeToggleOnPanel && (
            <button
              type="button"
              aria-expanded
              aria-label={historyPanelToggleLabel}
              title={historyPanelToggleLabel}
              onClick={handleChatPanelEdgeToggle}
              style={historyEdgeArcClipStyle}
              className={cn(
                'absolute right-0 top-1/2 z-30 -translate-y-1/2 translate-x-1/2',
                historyEdgeArcClass,
              )}
            >
              <ChevronLeft className="relative z-10 h-4 w-4 -translate-x-2" strokeWidth={1.65} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
