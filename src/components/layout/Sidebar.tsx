/**
 * Sidebar — 单列宽侧栏（248px / 72px），对齐 STO Claw 归档设计稿。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom';
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
import { useAuthStore } from '@/stores/auth';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import { looksLikeTechnicalSessionDisplay } from '@/stores/chat/helpers';
import logoSvg from '@/assets/logo.svg';
import packageJson from '../../../package.json';
import { taskDetailPath, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { isHiddenStoTaskSubitemChatSessionKey } from '@/lib/sto-task-session';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import { getSidebarLayoutVariant, getSidebarVisibility } from '@/lib/sidebar-layout';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

let didBootstrapFreshChat = false;

const INITIAL_NOW_MS = Date.now();

/** Collapsed rail: offset from narrow bar + opaque popover so glass tooltips do not show main content through them. */
const SIDEBAR_COLLAPSED_TOOLTIP_SURFACE =
  '!bg-popover text-popover-foreground shadow-md backdrop-blur-none border-border';

/** Footer account dropdown — panel and row hover (design spec). */
const SIDEBAR_ACCOUNT_MENU_CONTENT_CLASS = 'w-48 rounded-[12px] border-0 shadow-lg';
const SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS = 'rounded-[12px] border-0 shadow-lg';
const SIDEBAR_ACCOUNT_MENU_ITEM_HOVER =
  'hover:bg-[#F5F6F7] focus:bg-[#F5F6F7] data-[highlighted]:bg-[#F5F6F7] data-[state=open]:bg-[#F5F6F7]';

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

function collapsedEntryLabel(full: string): string {
  const s = full.trim();
  if (!s) return '…';
  const first = [...s][0];
  return `${first}…`;
}

const STO_TASK_NAV: { id: StoTaskId; labelKey: 'taskHqReconciliation' }[] = [
  { id: 'hq-reconciliation', labelKey: 'taskHqReconciliation' },
];

function SidebarTaskDateLinks({
  taskId,
  entries,
  onRequestDeleteSubitem,
}: {
  taskId: StoTaskId;
  entries: readonly string[];
  onRequestDeleteSubitem: (payload: {
    taskId: StoTaskId;
    entryId: string;
    label: string;
    sessionKey: string;
  }) => void;
}) {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation(['tasks', 'common']);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const sessionKeyBySubitem = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem);
  const isSubitemUnread = useStoTaskSubitemsStore((s) => s.isSubitemUnread);
  const markSubitemReadFromActivity = useStoTaskSubitemsStore((s) => s.markSubitemReadFromActivity);
  return (
    <>
      {entries.map((entryId) => {
        const to = taskDetailPath(taskId, entryId);
        const active = pathname === to;
        const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
        const activity = sk ? (sessionLastActivity[sk] ?? 0) : 0;
        const unread = isSubitemUnread(taskId, entryId, activity);
        const dateLabel = formatMaterialDateFromEntryId(entryId, i18n.language);
        const label = t('tasks:sidebarMaterialTitle', { date: dateLabel });
        return (
          <div key={entryId} className="group relative flex w-full items-center">
            <NavLink
              to={to}
              onClick={() => {
                if (!sk) return;
                const a = useChatStore.getState().sessionLastActivity[sk] ?? 0;
                if (a > 0) markSubitemReadFromActivity(taskId, entryId, a);
              }}
              className={cn(
                'relative z-[1] inline-flex w-full max-w-full items-center justify-between gap-2 rounded-[8px] px-[10px] py-[6px] pr-9 text-left text-xs font-medium transition-colors',
                active
                  ? 'bg-[#E5E6EB] text-foreground dark:bg-white/[0.12]'
                  : 'text-muted-foreground hover:bg-[rgba(229,230,235,0.7)] hover:text-foreground dark:hover:bg-white/[0.08]',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {unread ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
                  aria-label={t('tasks:unreadBadge', { defaultValue: 'Unread' })}
                />
              ) : null}
            </NavLink>
            {sk ? (
              <button
                type="button"
                aria-label={t('common:actions.delete')}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRequestDeleteSubitem({ taskId, entryId, label, sessionKey: sk });
                }}
                className={cn(
                  'absolute right-1 z-[2] flex items-center justify-center rounded p-0.5 transition-opacity',
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
    </>
  );
}

/** 侧栏任务：有子项时为可折叠 + 药丸链接；无子项时为主项直达总览。 */
function SidebarTaskGroup({
  taskId,
  label,
  onRequestDeleteSubitem,
}: {
  taskId: StoTaskId;
  label: string;
  onRequestDeleteSubitem: (payload: {
    taskId: StoTaskId;
    entryId: string;
    label: string;
    sessionKey: string;
  }) => void;
}) {
  const { pathname } = useLocation();
  const { t: tTasks } = useTranslation('tasks');
  const rawEntryIds = useStoTaskSubitemsStore((s) => s.entriesByTask[taskId]);
  const sessionKeyBySubitem = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem);
  const isSubitemUnread = useStoTaskSubitemsStore((s) => s.isSubitemUnread);
  const ensureSubitem = useStoTaskSubitemsStore((s) => s.ensureSubitem);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const entries = useMemo(() => {
    const ids = rawEntryIds ?? [];
    return [...new Set(ids)].sort((a, b) => b.localeCompare(a));
  }, [rawEntryIds]);

  const hasUnreadSubitem = useMemo(() => {
    if (entries.length === 0) return false;
    for (const entryId of entries) {
      const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
      const activity = sk ? (sessionLastActivity[sk] ?? 0) : 0;
      if (isSubitemUnread(taskId, entryId, activity)) return true;
    }
    return false;
  }, [entries, taskId, sessionKeyBySubitem, sessionLastActivity, isSubitemUnread]);

  useLayoutEffect(() => {
    for (const entryId of entries) {
      ensureSubitem(taskId, entryId);
    }
  }, [entries, taskId, ensureSubitem]);
  const overviewTo = taskOverviewPath(taskId);
  const underTask =
    entries.length > 0
      ? pathname.startsWith(`/tasks/${taskId}`)
      : pathname === overviewTo || pathname.startsWith(`${overviewTo}/`);

  const [open, setOpen] = useState(true);
  const prevUnderTask = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevUnderTask.current === false && underTask) {
      queueMicrotask(() => {
        setOpen(true);
      });
    }
    prevUnderTask.current = underTask;
  }, [underTask]);

  if (entries.length === 0) {
    return (
      <NavLink
        to={overviewTo}
        className="flex items-center justify-between gap-2 rounded-[8px] px-[10px] py-[6px] text-left transition-colors"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
        {hasUnreadSubitem ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
            aria-label={tTasks('unreadBadge', { defaultValue: 'Unread' })}
          />
        ) : null}
      </NavLink>
    );
  }

  const panelId = `sto-sidebar-task-${taskId}-entries`;

  return (
    <div className="rounded-lg">
      <button
        type="button"
        id={`sto-sidebar-task-${taskId}-toggle`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="group/sto-task-row flex w-full items-center justify-between gap-2 rounded-[8px] px-[10px] py-[6px] text-left outline-none ring-offset-2 transition-colors hover:bg-[rgba(229,230,235,0.7)] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {hasUnreadSubitem ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--destructive))]"
              aria-label={tTasks('unreadBadge', { defaultValue: 'Unread' })}
            />
          ) : null}
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover/sto-task-row:opacity-100 group-focus-within/sto-task-row:opacity-100',
              open ? 'rotate-180' : '',
            )}
            aria-hidden
            strokeWidth={2}
          />
        </span>
      </button>
      {open ? (
        <div id={panelId} className="mt-1.5 flex flex-col items-start gap-1" role="region" aria-labelledby={`sto-sidebar-task-${taskId}-toggle`}>
          <SidebarTaskDateLinks
            taskId={taskId}
            entries={entries}
            onRequestDeleteSubitem={onRequestDeleteSubitem}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 任务列表 / 工作台：标题与展开/收缩图标并排；图标默认隐藏，hover / focus-within 行内按钮时显示。 */
function SidebarCollapsibleSectionLabel({
  open,
  onToggle,
  label,
  toggleAriaLabel,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  toggleAriaLabel: string;
}) {
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-label={toggleAriaLabel}
        onClick={onToggle}
        className="group/sto-sidebar-section-toggle flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-muted-foreground outline-none ring-offset-2 transition-colors hover:bg-[rgba(229,230,235,0.7)] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]"
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="min-w-0 truncate">{label}</span>
          <span
            className="shrink-0 text-muted-foreground/90 opacity-0 transition-opacity group-hover/sto-sidebar-section-toggle:opacity-100 group-focus-within/sto-sidebar-section-toggle:opacity-100"
            aria-hidden
          >
            {open ? (
              <ChevronDown className="h-4 w-4" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            )}
          </span>
        </span>
      </button>
    </div>
  );
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
  const { pathname } = useLocation();
  // 使用路径匹配生成 className（字符串），避免 TooltipTrigger asChild 与 NavLink 的函数 className 合并时被破坏，导致选中态（橙底白图标）不生效。
  const isActive = matchPath({ path: to, end: Boolean(end), caseSensitive: false }, pathname) != null;

  const linkClassName = cn(
    'relative flex items-center font-medium leading-none transition-[color,background-color,border-radius,filter] duration-200 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
    collapsed
      ? cn(
          'mx-auto box-border min-h-0 shrink-0 justify-center gap-0 rounded-[8px] text-[13px]',
          'h-[var(--sto-sidebar-collapsed-nav-item-h)] w-[var(--sto-sidebar-collapsed-nav-item-w)] max-w-[calc(100%-10px)] py-[var(--sto-sidebar-collapsed-nav-py)] px-[var(--sto-sidebar-collapsed-nav-px)]',
          isActive
            ? 'bg-[var(--sto-brand-6)] text-white shadow-sm hover:bg-[#ff8d2a] active:bg-[#d95700] [&_svg]:stroke-white dark:bg-[var(--sto-brand-6)] dark:text-white dark:hover:bg-[#ff8d2a]'
            : 'text-[var(--sto-sidebar-collapsed-nav-icon-idle)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
        )
      : cn(
          'shrink-0 gap-[10px] text-[13px]',
          isActive
            ? 'min-h-0 rounded-[8px] bg-[linear-gradient(138deg,#FF8F4A_-3%,#FF7A28_33%,#FF6700_71%,#E85A00_103%)] px-[10px] py-[5px] text-white shadow-sm hover:brightness-110 active:brightness-95 [&_svg]:stroke-white'
            : 'h-[28.5px] min-h-[28.5px] rounded-xl px-[10px] text-[#86909c] [&_svg]:stroke-[#86909c] hover:rounded-[8px] hover:bg-black/[0.04] hover:text-foreground hover:[&_svg]:stroke-foreground dark:text-muted-foreground dark:[&_svg]:stroke-[hsl(var(--muted-foreground))] dark:hover:bg-white/[0.06] dark:hover:text-foreground dark:hover:[&_svg]:stroke-foreground',
        ),
  );

  const link = (
    <NavLink to={to} end={end} className={linkClassName}>
      <span className="flex shrink-0 items-center justify-center">{icon}</span>
      {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={12}
          collisionPadding={12}
          className={cn('max-w-[14rem]', SIDEBAR_COLLAPSED_TOOLTIP_SURFACE)}
        >
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
  const removeSubitem = useStoTaskSubitemsStore((s) => s.removeSubitem);

  const gatewayStatus = useGatewayStore((s) => s.status);
  const isGatewayRunning = gatewayStatus.state === 'running';

  const authUser = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const crmWeekReportSurfaceAllowed = useAuthStore((s) => s.crmWeekReportSurfaceAllowed);

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const location = useLocation();
  const navigate = useNavigate();
  const isOnChat = location.pathname.startsWith('/chat');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [taskListSectionOpen, setTaskListSectionOpen] = useState(true);
  const [workspaceSectionOpen, setWorkspaceSectionOpen] = useState(true);
  const [bucketOpen, setBucketOpen] = useState<Record<SessionBucketKey, boolean>>({
    today: true,
    yesterday: true,
    withinWeek: true,
    withinTwoWeeks: true,
    withinMonth: true,
    older: true,
  });

  const { t } = useTranslation(['common', 'chat', 'auth', 'tasks']);

  const sidebarVis = useMemo(() => getSidebarVisibility(getSidebarLayoutVariant()), []);

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
  const [subitemToDelete, setSubitemToDelete] = useState<{
    taskId: StoTaskId;
    entryId: string;
    label: string;
    sessionKey: string;
  } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [nowMs, setNowMs] = useState(INITIAL_NOW_MS);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

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

  const visibleSessions = useMemo(
    () => sessions.filter((session) => !isHiddenStoTaskSubitemChatSessionKey(session.key)),
    [sessions],
  );

  const getEffectiveActivityMs = (sessionKey: string): number => {
    const recorded = sessionLastActivity[sessionKey] ?? 0;
    if (recorded > 0) return recorded;
    const isFreshCurrentSession = sessionKey === currentSessionKey && !sessionLabels[sessionKey];
    return isFreshCurrentSession ? nowMs : 0;
  };

  for (const session of [...visibleSessions].sort((a, b) =>
    getEffectiveActivityMs(b.key) - getEffectiveActivityMs(a.key),
  )) {
    const bucketKey = getSessionBucket(getEffectiveActivityMs(session.key), nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const sessionsOrderedForCollapse = sessionBuckets.flatMap((b) => b.sessions);

  const appVersionShort = packageJson.version?.split('-')[0] ?? packageJson.version;

  const toggleBucket = (key: SessionBucketKey) => {
    setBucketOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const primaryNav = useMemo(() => {
    const all: Array<{
      to: string;
      end?: boolean;
      icon: ReactNode;
      label: string;
    }> = [
      { to: '/', end: true, icon: <Home className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.home') },
      { to: '/chat', end: true, icon: <MessageSquare className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.chat') },
      { to: '/cron', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.cronTasks') },
      { to: '/skills', icon: <Puzzle className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.skills') },
      { to: '/models', icon: <BarChart3 className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.myData') },
    ];
    return all.filter((item) => {
      if (item.to === '/chat' && !sidebarVis.primaryChat) return false;
      if (item.to === '/models' && !sidebarVis.primaryMyData) return false;
      return true;
    });
  }, [sidebarVis.primaryChat, sidebarVis.primaryMyData, t]);

  const workspaceNav = [
    { to: '/agents', icon: <Bot className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.agents') },
    { to: '/channels', icon: <Radio className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.channels') },
    { to: '/subscriptions', icon: <Bookmark className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.subscriptions') },
  ];

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-[var(--sto-sidebar-border)] bg-[var(--sto-sidebar-bg)] transition-[width] duration-200 ease-out',
        sidebarCollapsed ? 'w-[var(--sto-sidebar-w-collapsed)]' : 'w-[var(--sto-sidebar-w-expanded)]',
      )}
    >
      {sidebarCollapsed ? (
        <div className="flex shrink-0 flex-col items-center border-b border-transparent px-2 pb-2 pt-3">
          <button
            type="button"
            aria-expanded={false}
            aria-label={t('common:sidebar.toggleSidebarExpand')}
            title={t('common:sidebar.toggleSidebarExpand')}
            onClick={() => setSidebarCollapsed(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sto-sidebar-border)] bg-white text-[var(--sto-sidebar-collapsed-nav-icon-idle)] transition-colors hover:border-[rgba(255,111,0,0.35)] hover:text-[var(--sto-brand-6)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:[&_svg]:stroke-[var(--sto-brand-6)] dark:bg-card"
          >
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--sto-sidebar-border)] px-3 pb-3 pt-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-1">
            <img src={logoSvg} alt="" className="h-10 w-10 shrink-0 rounded-[10px] object-contain" width={40} height={40} />
            <div className="min-w-0">
              <div className="text-[17px] font-bold leading-tight tracking-tight text-foreground">STO Claw</div>
              <div className="text-xs text-muted-foreground">
                {t('common:sidebar.appVersionLabel', { version: appVersionShort })}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-expanded={true}
            aria-label={t('common:sidebar.toggleSidebarCollapse')}
            title={t('common:sidebar.toggleSidebarCollapse')}
            onClick={() => setSidebarCollapsed(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sto-sidebar-border)] bg-white text-[var(--sto-sidebar-collapsed-nav-icon-idle)] transition-colors hover:border-[rgba(255,111,0,0.35)] hover:text-[var(--sto-brand-6)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:[&_svg]:stroke-[var(--sto-brand-6)] dark:bg-card"
          >
            <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      <nav
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-2 pt-2',
          sidebarCollapsed ? 'px-0' : 'px-2',
        )}
      >
        {/* 固定区：避免下方 flex-1 会话占位在滚动叠层时盖住任务子链（如第二条日期药丸） */}
        <div className="relative z-10 flex shrink-0 flex-col gap-1">
        <div className={cn('flex flex-col gap-1', sidebarCollapsed && 'mt-2')}>
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

        {!sidebarCollapsed && crmWeekReportSurfaceAllowed ? (
          <SidebarCollapsibleSectionLabel
            open={taskListSectionOpen}
            onToggle={() => setTaskListSectionOpen((o) => !o)}
            label={t('common:sidebar.taskList')}
            toggleAriaLabel={t('common:sidebar.toggleTaskListSection')}
          />
        ) : null}
        {!sidebarCollapsed && crmWeekReportSurfaceAllowed && taskListSectionOpen ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {STO_TASK_NAV.map((item) => (
              <SidebarTaskGroup
                key={item.id}
                taskId={item.id}
                label={t(`common:sidebar.${item.labelKey}`)}
                onRequestDeleteSubitem={setSubitemToDelete}
              />
            ))}
          </div>
        ) : null}

        {sidebarVis.workspace ? (
          !sidebarCollapsed ? (
            <SidebarCollapsibleSectionLabel
              open={workspaceSectionOpen}
              onToggle={() => setWorkspaceSectionOpen((o) => !o)}
              label={t('common:sidebar.workspace')}
              toggleAriaLabel={t('common:sidebar.toggleWorkspaceSection')}
            />
          ) : (
            <div className="mx-auto mt-3 h-px w-8 bg-[var(--sto-sidebar-border)]" aria-hidden />
          )
        ) : null}
        {sidebarVis.workspace && (sidebarCollapsed || workspaceSectionOpen) && (
        <div className="flex flex-col gap-1">
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
        )}

        {sidebarVis.conversationChrome ? (
          !sidebarCollapsed ? (
            <p className="mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
              {t('common:sidebar.sessionList')}
            </p>
          ) : (
            <div className="mx-auto mt-3 h-px w-8 bg-[var(--sto-sidebar-border)]" aria-hidden />
          )
        ) : null}

        {sidebarVis.conversationChrome ? (
          !sidebarCollapsed ? (
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
                  className="mx-auto mt-2 flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--sto-sidebar-border)] bg-white text-[var(--sto-sidebar-collapsed-nav-icon-idle)] transition-colors hover:border-[rgba(255,111,0,0.35)] hover:text-[var(--sto-brand-6)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:[&_svg]:stroke-[var(--sto-brand-6)] dark:bg-card"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={12}
                collisionPadding={12}
                className={SIDEBAR_COLLAPSED_TOOLTIP_SURFACE}
              >
                {t('common:sidebar.newChat')}
              </TooltipContent>
            </Tooltip>
          )
        ) : null}
        </div>

        <div className="relative z-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden space-y-1 pb-2 pt-1">
          {sidebarCollapsed && sessionsOrderedForCollapse.length > 0 ? (
            <div className="flex flex-col gap-1">
              {sessionsOrderedForCollapse.map((s) => {
                const full = getSessionLabel(s.key, s.displayName, s.label);
                const short = collapsedEntryLabel(full);
                const active = isOnChat && currentSessionKey === s.key;
                return (
                  <Tooltip key={s.key} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          switchSession(s.key);
                          navigate('/chat');
                        }}
                        className={cn(
                          'mx-auto flex min-h-0 min-w-0 items-center justify-center rounded-[8px] font-medium leading-none transition-colors',
                          'h-[var(--sto-sidebar-collapsed-nav-item-h)] w-[var(--sto-sidebar-collapsed-nav-item-w)] max-w-[calc(100%-10px)] py-[var(--sto-sidebar-collapsed-nav-py)] px-[var(--sto-sidebar-collapsed-nav-px)] text-[13px]',
                          active
                            ? 'bg-[var(--sto-brand-6)] text-white shadow-sm hover:bg-[#ff8d2a] dark:bg-[var(--sto-brand-6)]'
                            : 'text-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
                        )}
                      >
                        <span className="truncate">{short}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      sideOffset={12}
                      collisionPadding={12}
                      className={cn(
                        SIDEBAR_COLLAPSED_TOOLTIP_SURFACE,
                        'max-w-[min(24rem,calc(100vw-3rem))] whitespace-normal break-words px-3 py-2 text-left leading-snug',
                      )}
                    >
                      {full}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ) : null}
          {!sidebarCollapsed &&
            (visibleSessions.length === 0 ? (
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
                    className="flex w-full items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:bg-[rgba(229,230,235,0.7)] dark:hover:bg-white/[0.08]"
                  >
                    <span className="truncate">{bucket.label}</span>
                    <ChevronDown
                      className={cn('h-4 w-4 shrink-0 transition-transform', bucketOpen[bucket.key] ? 'rotate-180' : '')}
                      aria-hidden
                    />
                  </button>
                  {bucketOpen[bucket.key] &&
                    bucket.sessions.map((s) => (
                      <div key={s.key} className="group relative flex items-center">
                        <button
                          type="button"
                          onClick={() => {
                            switchSession(s.key);
                            navigate('/chat');
                          }}
                          title={getSessionLabel(s.key, s.displayName, s.label)}
                          className={cn(
                            'w-full rounded-[8px] px-[10px] py-[6px] pr-9 text-left text-[13px] transition-colors',
                            isOnChat && currentSessionKey === s.key
                              ? 'bg-[#E5E6EB] font-medium text-foreground dark:bg-white/[0.12]'
                              : 'text-foreground/80 hover:bg-[rgba(229,230,235,0.7)] hover:text-foreground dark:hover:bg-white/[0.08]',
                          )}
                        >
                          <span className="block min-w-0 truncate">{getSessionLabel(s.key, s.displayName, s.label)}</span>
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
                    ))}
                </div>
              ) : null,
              )
            )
          )}
        </div>
      </nav>

      {authUser ? (
        <div className="shrink-0 bg-[var(--sto-sidebar-bg)] p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex w-full text-left transition-colors',
                  sidebarVis.userProfileCard
                    ? sidebarCollapsed
                      ? 'flex-col items-center justify-center gap-0 p-2'
                      : 'items-center justify-between gap-3 rounded-[8px] bg-[#F5F6F7] p-3 hover:bg-[#E5E6EB] dark:bg-muted/25 dark:hover:bg-muted/50'
                    : 'items-center justify-center rounded-[8px] p-2 hover:bg-[#F0F2F5] dark:hover:bg-muted/40',
                )}
                title={
                  sidebarVis.userProfileCard
                    ? isGatewayRunning
                      ? t('common:status.connected')
                      : t('common:status.disconnected')
                    : `${t('common:sidebar.compactAccountMenu')} — ${isGatewayRunning ? t('common:status.connected') : t('common:status.disconnected')}`
                }
                aria-label={sidebarVis.userProfileCard ? undefined : t('common:sidebar.compactAccountMenu')}
              >
                {sidebarVis.userProfileCard ? (
                  <>
                    {sidebarCollapsed ? (
                      <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--sto-sidebar-border)] bg-white text-[13px] font-semibold text-[var(--sto-brand-6)] dark:bg-card">
                        {authUser.realName?.[0] || authUser.userName?.[0] || '?'}
                      </span>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="truncate text-sm font-bold leading-tight text-[#1D2129] dark:text-foreground">
                            {authUser.realName?.trim() || authUser.userName}
                          </span>
                          {authUser.companyName?.trim() ? (
                            <span className="truncate text-xs font-normal leading-snug text-[#86909C] dark:text-muted-foreground">
                              {authUser.companyName.trim()}
                            </span>
                          ) : null}
                        </div>
                        <SettingsIcon
                          className="h-5 w-5 shrink-0 text-[#86909C] dark:text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />
                      </>
                    )}
                  </>
                ) : (
                  <SettingsIcon className="h-5 w-5 shrink-0 text-[#86909C] dark:text-muted-foreground" strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className={SIDEBAR_ACCOUNT_MENU_CONTENT_CLASS}
            >
              <DropdownMenuItem
                onClick={() => navigate('/settings')}
                className={cn('gap-2', SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
              >
                <SettingsIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
                {t('common:sidebar.settings')}
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className={cn('gap-2', SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}>
                  <Globe className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="flex-1">{t('settings:appearance.language')}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" strokeWidth={2} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4} className={SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS}>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={cn('gap-2', SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
                    >
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
                <DropdownMenuSubTrigger className={cn('gap-2', SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}>
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
                <DropdownMenuSubContent sideOffset={4} className={SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS}>
                  {(['light', 'dark', 'system'] as const).map((t_value) => (
                    <DropdownMenuItem
                      key={t_value}
                      onClick={() => setTheme(t_value)}
                      className={cn('gap-2', SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
                    >
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
                className={cn(
                  'gap-2 text-destructive focus:text-destructive',
                  SIDEBAR_ACCOUNT_MENU_ITEM_HOVER,
                )}
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
        open={!!subitemToDelete}
        title={t('common:actions.confirm')}
        message={t('tasks:deleteSubitemConfirm', { label: subitemToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        onConfirm={async () => {
          if (!subitemToDelete) return;
          const { sessionKey, taskId, entryId } = subitemToDelete;
          await deleteSession(sessionKey);
          removeSubitem(taskId, entryId);
          if (currentSessionKey === sessionKey) navigate('/chat');
          setSubitemToDelete(null);
        }}
        onCancel={() => setSubitemToDelete(null)}
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
