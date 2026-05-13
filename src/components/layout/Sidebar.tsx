/**
 * Sidebar — 单列宽侧栏（248px / 72px），对齐 STO Claw 归档设计稿。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  Globe,
  Check,
  Sun,
  Moon,
  Monitor,
  Bookmark,
  Home,
  BarChart3,
  Bot,
  Radio,
  ChevronDown,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSettingsStore } from '@/stores/settings';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useAuthStore } from '@/stores/auth';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';
import logoSvg from '@/assets/logo.svg';
import packageJson from '../../../package.json';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

let didBootstrapFreshChat = false;

const INITIAL_NOW_MS = Date.now();

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

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function SidebarNavLink({
  to,
  end,
  icon,
  label,
  collapsed,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-xl py-2.5 text-[14px] font-medium transition-colors',
          collapsed ? 'mx-1 justify-center px-0' : 'px-3',
          isActive
            ? 'bg-[var(--sto-accent-soft)] text-[var(--sto-accent)] shadow-sm ring-1 ring-[rgba(255,140,0,0.35)] dark:bg-amber-950/40 dark:text-[var(--sto-accent)]'
            : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.06]',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && !collapsed ? (
            <span className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--sto-accent)]" />
          ) : null}
          <span className="flex shrink-0 items-center justify-center">{icon}</span>
          {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
        </>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-[14rem]">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return link;
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

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const location = useLocation();
  const navigate = useNavigate();
  const isOnChat = location.pathname.startsWith('/chat');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [bucketOpen, setBucketOpen] = useState<Record<SessionBucketKey, boolean>>({
    today: true,
    yesterday: true,
    withinWeek: true,
    withinTwoWeeks: true,
    withinMonth: true,
    older: true,
  });

  const { t } = useTranslation(['common', 'chat', 'auth']);

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    (async () => {
      await loadSessions();
      if (cancelled) return;

      if (!isOnChat) {
        const hasExistingMessages = useChatStore.getState().messages.length > 0;
        await loadHistory(hasExistingMessages);
        return;
      }

      if (!didBootstrapFreshChat) {
        didBootstrapFreshChat = true;
        if (useChatStore.getState().sessions.length === 0) {
          newSession();
        }
        await loadHistory(false);
        return;
      }

      const hasExistingMessages = useChatStore.getState().messages.length > 0;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, isOnChat, loadHistory, loadSessions, newSession]);

  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

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

  const appVersionShort = packageJson.version?.split('-')[0] ?? packageJson.version;

  const toggleBucket = (key: SessionBucketKey) => {
    setBucketOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const primaryNav = [
    { to: '/', end: true, icon: <Home className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.home') },
    { to: '/chat', end: true, icon: <MessageSquare className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.chat') },
    { to: '/cron', icon: <Clock className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.cronTasks') },
    { to: '/skills', icon: <Puzzle className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.skills') },
    { to: '/models', icon: <BarChart3 className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.myData') },
  ];

  const workspaceNav = [
    { to: '/agents', icon: <Bot className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.agents') },
    { to: '/channels', icon: <Radio className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.channels') },
    { to: '/subscriptions', icon: <Bookmark className="h-5 w-5" strokeWidth={1.75} />, label: t('common:sidebar.subscriptions') },
  ];

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[var(--sto-sidebar-border)] bg-[var(--sto-sidebar-bg)] transition-[width] duration-200 ease-out',
        sidebarCollapsed ? 'w-[var(--sto-sidebar-w-collapsed)]' : 'w-[var(--sto-sidebar-w-expanded)]',
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-start justify-between gap-2 border-b border-[var(--sto-sidebar-border)] px-3 pb-3 pt-3',
          sidebarCollapsed && 'flex-col items-center border-transparent px-2 pb-2',
        )}
      >
        {!sidebarCollapsed ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
            <img src={logoSvg} alt="" className="h-10 w-10 shrink-0 rounded-[10px] object-contain" width={40} height={40} />
            <div className="min-w-0">
              <div className="text-[17px] font-bold leading-tight tracking-tight text-foreground">STO Claw</div>
              <div className="text-xs text-muted-foreground">
                {t('common:sidebar.appVersionLabel', { version: appVersionShort })}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex w-full justify-center pt-0.5">
            <img src={logoSvg} alt="" className="h-9 w-9 rounded-[10px] object-contain" width={36} height={36} />
          </div>
        )}
        <button
          type="button"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? t('common:sidebar.toggleSidebarExpand') : t('common:sidebar.toggleSidebarCollapse')}
          title={sidebarCollapsed ? t('common:sidebar.toggleSidebarExpand') : t('common:sidebar.toggleSidebarCollapse')}
          onClick={() => setSidebarCollapsed((c) => !c)}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--sto-sidebar-border)] bg-white text-muted-foreground transition-colors hover:border-[rgba(255,140,0,0.45)] hover:text-[var(--sto-accent)] dark:bg-card dark:text-muted-foreground',
            sidebarCollapsed && 'mt-1',
          )}
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          ) : (
            <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-2">
        <div className="flex flex-col gap-0.5">
          {primaryNav.map((item) => (
            <SidebarNavLink
              key={item.to}
              to={item.to}
              end={item.end}
              icon={item.icon}
              label={item.label}
              collapsed={sidebarCollapsed}
            />
          ))}
        </div>

        {!sidebarCollapsed ? (
          <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            {t('common:sidebar.workspace')}
          </p>
        ) : (
          <div className="mx-auto mt-3 h-px w-8 bg-[var(--sto-sidebar-border)]" aria-hidden />
        )}
        <div className="flex flex-col gap-0.5">
          {workspaceNav.map((item) => (
            <SidebarNavLink
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              collapsed={sidebarCollapsed}
            />
          ))}
        </div>

        {!sidebarCollapsed ? (
          <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            {t('common:sidebar.sessionList')}
          </p>
        ) : (
          <div className="mx-auto mt-3 h-px w-8 bg-[var(--sto-sidebar-border)]" aria-hidden />
        )}

        {!sidebarCollapsed ? (
          <button
            type="button"
            onClick={() => {
              const { messages } = useChatStore.getState();
              if (messages.length > 0) newSession();
              navigate('/chat');
            }}
            className="mx-1 mt-1 flex items-center gap-2 rounded-xl border border-[rgba(255,140,0,0.35)] bg-[var(--sto-accent-soft)] px-3 py-2.5 text-left text-[13px] font-semibold text-[var(--sto-accent)] shadow-sm transition-colors hover:opacity-95 dark:bg-amber-950/35"
          >
            <Plus className="h-[17px] w-[17px] shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">{t('common:sidebar.newChat')}</span>
          </button>
        ) : (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t('common:sidebar.newChat')}
                title={t('common:sidebar.newChat')}
                onClick={() => {
                  const { messages } = useChatStore.getState();
                  if (messages.length > 0) newSession();
                  navigate('/chat');
                }}
                className="mx-1 mt-1 flex h-10 w-10 items-center justify-center self-center rounded-xl border border-[rgba(255,140,0,0.35)] bg-[var(--sto-accent-soft)] text-[var(--sto-accent)] dark:bg-amber-950/35"
              >
                <Plus className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('common:sidebar.newChat')}</TooltipContent>
          </Tooltip>
        )}

        <div className="min-h-0 flex-1 space-y-1 pb-2 pt-1">
          {!sidebarCollapsed &&
            (sessions.length === 0 ? (
              <p className="px-2 pt-2 text-center text-[12px] leading-relaxed text-muted-foreground/80">
                {t('common:sidebar.emptyChatHistory')}
              </p>
            ) : (
              sessionBuckets.map((bucket) =>
                bucket.sessions.length > 0 ? (
                <div key={bucket.key} className="rounded-lg">
                  <button
                    type="button"
                    onClick={() => toggleBucket(bucket.key)}
                    className="flex w-full items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
                  >
                    <span className="truncate">{bucket.label}</span>
                    <ChevronDown
                      className={cn('h-4 w-4 shrink-0 transition-transform', bucketOpen[bucket.key] ? 'rotate-180' : '')}
                      aria-hidden
                    />
                  </button>
                  {bucketOpen[bucket.key] &&
                    bucket.sessions.map((s) => {
                      const agentId = getAgentIdFromSessionKey(s.key);
                      const agentName = agentNameById[agentId] || agentId;
                      return (
                        <div key={s.key} className="group relative flex items-center">
                          <button
                            type="button"
                            onClick={() => {
                              switchSession(s.key);
                              navigate('/chat');
                            }}
                            title={getSessionLabel(s.key, s.displayName, s.label)}
                            className={cn(
                              'w-full rounded-xl py-2 text-left text-[13px] transition-colors',
                              'px-2.5 pr-8',
                              isOnChat && currentSessionKey === s.key
                                ? 'bg-[var(--sto-accent-soft)] font-medium text-[var(--sto-accent)] ring-1 ring-[rgba(255,140,0,0.35)] dark:bg-amber-950/35'
                                : 'text-foreground/80 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]',
                            )}
                          >
                            <div className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate">{getSessionLabel(s.key, s.displayName, s.label)}</span>
                              <span className="truncate text-[10px] text-muted-foreground/85">{agentName}</span>
                            </div>
                          </button>
                          {!sidebarCollapsed ? (
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
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              ) : null,
              )
            )
          )}
        </div>
      </nav>

      {authUser ? (
        <div className="shrink-0 border-t border-[var(--sto-sidebar-border)] p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full rounded-xl border border-transparent bg-white/80 text-left transition-colors hover:border-[rgba(255,140,0,0.35)] hover:bg-white dark:bg-card/80 dark:hover:bg-card',
                  sidebarCollapsed ? 'flex-col items-center justify-center gap-0 p-2' : 'items-center gap-2 p-2',
                )}
                title={isGatewayRunning ? t('common:status.connected') : t('common:status.disconnected')}
              >
                {sidebarCollapsed ? (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {authUser.realName?.[0] || authUser.userName?.[0] || '?'}
                  </span>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {authUser.realName || authUser.userName}
                        </span>
                        <span className="shrink-0 rounded bg-[var(--sto-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[#b45309] dark:bg-amber-950/50 dark:text-amber-200">
                          {t('common:sidebar.enterpriseTag')}
                        </span>
                      </div>
                      <span className="truncate text-[11px] text-muted-foreground">
                        ID {authUser.id}
                        {authUser.departmentName ? ` · ${authUser.departmentName}` : ''}
                      </span>
                    </div>
                    <SettingsIcon className="h-5 w-5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-48">
              <DropdownMenuItem onClick={() => navigate('/settings')} className="gap-2">
                <SettingsIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {t('common:sidebar.settings')}
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  <Globe className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="flex-1">{t('settings:appearance.language')}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4}>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <DropdownMenuItem key={lang.code} onClick={() => setLanguage(lang.code)} className="gap-2">
                      {language === lang.code ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      {lang.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2">
                  {theme === 'light' ? (
                    <Sun className="h-4 w-4 shrink-0" strokeWidth={2} />
                  ) : theme === 'dark' ? (
                    <Moon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  ) : (
                    <Monitor className="h-4 w-4 shrink-0" strokeWidth={2} />
                  )}
                  <span className="flex-1">{t('settings:appearance.theme')}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4}>
                  {(['light', 'dark', 'system'] as const).map((t_value) => (
                    <DropdownMenuItem key={t_value} onClick={() => setTheme(t_value)} className="gap-2">
                      {theme === t_value ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                      ) : (
                        <span className="w-3.5 shrink-0" />
                      )}
                      {t(`settings:appearance.${t_value}`)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() => setShowLogoutConfirm(true)}
                className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
                {t('auth:logout.button')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

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
          if (currentSessionKey === sessionToDelete.key) navigate('/chat');
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
  );
}
