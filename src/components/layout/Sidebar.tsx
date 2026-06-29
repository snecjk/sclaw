/**
 * Sidebar — 单列宽侧栏。
 * 省区布局：展开 260px / 收起 w-0 完全隐藏；折叠钮在侧栏列顶行（无全局顶栏）。
 * 完整布局：展开 260px / 收起 72px 图标轨。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom';
import {
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  LogOut,
  ChevronRight,
  Globe,
  Check,
  Sun,
  Moon,
  Monitor,
  Bookmark,
  ClipboardList,
  MessageSquarePlus,
  BarChart3,
  Bot,
  Radio,
  ChevronDown,
  Workflow,
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
import { SidebarUpdateNotice } from '@/components/layout/sidebar-update-notice';
import { useSettingsStore } from '@/stores/settings';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAuthStore } from '@/stores/auth';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SidebarBrandHeader } from '@/components/layout/sidebar-brand-header';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { SidebarRunningIcon } from '@/components/layout/sidebar-running-icon';
import { SidebarRecentSessionRowTrailing } from '@/components/layout/sidebar-recent-session-row-trailing';
import {
  SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS,
  SidebarTaskSubitemDeleteTrailing,
} from '@/components/layout/sidebar-task-subitem-delete-trailing';
import { useTranslation } from 'react-i18next';
import { resolveSessionLabel } from '@/lib/session-label';
import { taskDetailPath, taskOverviewPath, type StoTaskId } from '@/lib/sto-tasks';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { isSidebarHiddenChatSessionKey } from '@/lib/sto-task-session';
import {
  parseClaudeScheduledTaskSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
  parseCronSessionKey,
  parseScheduledTaskAgentSessionKey,
  isAnyCronSessionKey,
} from '@/stores/chat/cron-session-utils';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import { getCurrentEnvConfig } from '../../../shared/env-config';
import { getSidebarLayoutVariant, getSidebarVisibility } from '@/lib/sidebar-layout';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import {
  sidebarFooterMetaClass,
  sidebarFooterNameClass,
  sidebarFooterSettingsIconClass,
  sidebarListItemTextClass,
  sidebarMetaLinkClass,
  sidebarNavExpandedActiveClass,
  sidebarNavExpandedIdleClass,
  sidebarSectionChevronClass,
  sidebarSectionLabelClass,
  sidebarSubitemTextActiveClass,
  sidebarSubitemTextIdleClass,
  sidebarTextIconClass,
  sidebarTextSectionClass,
  sidebarUnreadDotClass,
  sidebarSectionStickyShellClass,
  sidebarSectionStickyTopTaskClass,
  sidebarSectionStickyTopRecentClass,
  sidebarScrollListClass,
} from '@/lib/surfaces';
import { useSidebarTaskScrollCollapse } from '@/hooks/use-sidebar-task-scroll-collapse';

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older'
  | 'cronTasks';


const INITIAL_NOW_MS = Date.now();

/** Collapsed rail: offset from narrow bar + opaque popover so glass tooltips do not show main content through them. */
const SIDEBAR_COLLAPSED_TOOLTIP_SURFACE =
  '!bg-popover text-popover-foreground shadow-md backdrop-blur-none border-border';

/** Footer account dropdown — panel and row hover (design spec). */
const SIDEBAR_ACCOUNT_MENU_CONTENT_CLASS = 'w-48 rounded-[12px] border-0 shadow-lg';
const SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS = 'rounded-[12px] border-0 shadow-lg';
const SIDEBAR_ACCOUNT_MENU_ITEM_HOVER =
  'hover:bg-[#F5F6F7] focus:bg-[#F5F6F7] data-[highlighted]:bg-[#F5F6F7] data-[state=open]:bg-[#F5F6F7] dark:hover:bg-muted dark:focus:bg-muted dark:data-[highlighted]:bg-muted dark:data-[state=open]:bg-muted';
const SIDEBAR_BUCKET_INITIAL_LIMIT = 60;
const SIDEBAR_BUCKET_LOAD_MORE_COUNT = 60;
const SIDEBAR_COLLAPSED_SESSION_LIMIT = 40;
/** 任务列表首屏一级组数上限（不含组内子项行数） */
const SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT = 8;
/** 旧版按日期分桶渲染（today/yesterday/…）— 保留逻辑，UI 已合并为「最近」单列表 */
const USE_LEGACY_SESSION_DATE_BUCKETS = false;

/** 侧栏收起态：展开按钮 */
const SIDEBAR_COLLAPSED_EXPAND_BTN_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--sto-sidebar-border)] bg-white text-[var(--sto-sidebar-collapsed-nav-icon-idle)] transition-colors hover:border-[rgba(255,111,0,0.35)] hover:text-[var(--sto-brand-6)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:[&_svg]:stroke-[var(--sto-brand-6)] dark:bg-card';

/** 任务组保留组级 chevron；手风琴：默认全收起，同时仅展开一组（§5.3 用户确认） */
const SIDEBAR_SHOW_TASK_GROUP_CHEVRON = true;

/** 任务组二级行 */
const SIDEBAR_TASK_GROUP_ROW_CLASS =
  'flex h-9 w-full items-center justify-between gap-2 rounded-lg px-[10px] py-2 text-left outline-none ring-offset-2 transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring';
/** 三级子项容器 — 竖线过二级 icon 中心；w-[calc(100%-18px)] 避免 ml+w-full 右侧溢出被裁切 */
const SIDEBAR_TASK_SUBITEMS_CONTAINER_CLASS =
  'ml-[18px] flex w-[calc(100%-18px)] flex-col gap-0.5 border-l border-border pl-4';

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

function isTemporaryAgentSessionKey(key: string): boolean {
  return /^agent:[^:]+:session-\d+/.test(key);
}

const STO_TASK_NAV: { id: StoTaskId; labelKey: 'taskHqReconciliation' | 'taskWeeklyPpt' }[] = [
  { id: 'hq-reconciliation', labelKey: 'taskHqReconciliation' },
];

function stoTaskSidebarGroupKey(taskId: StoTaskId): string {
  return `sto:${taskId}`;
}

function scheduledTaskSidebarGroupKey(groupKey: string): string {
  return `scheduled:${groupKey}`;
}

type ScheduledTaskSidebarGroup = {
  key: string;
  name: string;
  sessions: Array<{ key: string; label?: string; displayName?: string; updatedAt?: number }>;
};

type TaskListRenderItem =
  | { kind: 'sto'; navItem: (typeof STO_TASK_NAV)[number]; maxVisibleEntries?: number }
  | { kind: 'scheduled'; group: ScheduledTaskSidebarGroup; maxVisibleSessions?: number };

function buildTaskListRenderPlan(
  scheduledGroups: ScheduledTaskSidebarGroup[],
  showAll: boolean,
): { items: TaskListRenderItem[]; totalRows: number } {
  const allItems: TaskListRenderItem[] = [
    ...STO_TASK_NAV.map((navItem) => ({ kind: 'sto' as const, navItem })),
    ...scheduledGroups
      .filter((group) => group.sessions.length > 0)
      .map((group) => ({ kind: 'scheduled' as const, group })),
  ];

  const totalRows = allItems.length;

  if (showAll || totalRows <= SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT) {
    return { items: allItems, totalRows };
  }

  return {
    items: allItems.slice(0, SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT),
    totalRows,
  };
}

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

  useEffect(() => {
    const activeEntry = entries.find((entryId) => pathname === taskDetailPath(taskId, entryId));
    if (!activeEntry) return;
    const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, activeEntry)] ?? '';
    if (!sk) return;
    const a = sessionLastActivity[sk] ?? 0;
    if (a > 0) markSubitemReadFromActivity(taskId, activeEntry, a);
  }, [entries, pathname, taskId, sessionKeyBySubitem, sessionLastActivity, markSubitemReadFromActivity]);

  return (
    <>
      {entries.map((entryId) => {
        const to = taskDetailPath(taskId, entryId);
        const active = pathname === to;
        const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
        const activity = sk ? (sessionLastActivity[sk] ?? 0) : 0;
        const unread = !active && isSubitemUnread(taskId, entryId, activity);
        const dateLabel = formatMaterialDateFromEntryId(entryId, i18n.language);
        const label = t('tasks:sidebarMaterialTitle', { date: dateLabel });
        return (
          <div key={entryId} className="group relative flex w-full min-w-0 items-center">
            <NavLink
              to={to}
              onClick={() => {
                if (!sk) return;
                const a = useChatStore.getState().sessionLastActivity[sk] ?? 0;
                if (a > 0) markSubitemReadFromActivity(taskId, entryId, a);
              }}
              className={cn(
                'relative z-[1] inline-flex h-7 w-full min-w-0 max-w-full items-center justify-between gap-2 overflow-hidden rounded-lg px-[10px] py-1 text-left transition-colors',
                SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS,
                active ? sidebarSubitemTextActiveClass : sidebarSubitemTextIdleClass,
              )}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {unread ? (
                <span
                  className={sidebarUnreadDotClass}
                  aria-label={t('tasks:unreadBadge', { defaultValue: 'Unread' })}
                />
              ) : null}
            </NavLink>
            {sk ? (
              <SidebarTaskSubitemDeleteTrailing
                isActive={active}
                onDelete={() => onRequestDeleteSubitem({ taskId, entryId, label, sessionKey: sk })}
              />
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
  isOpen,
  onToggle,
  onRequestExpand,
  onRequestDeleteSubitem,
  maxVisibleEntries,
}: {
  taskId: StoTaskId;
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  /** 路由进入该任务时自动展开（手风琴仅保留本组） */
  onRequestExpand: () => void;
  onRequestDeleteSubitem: (payload: {
    taskId: StoTaskId;
    entryId: string;
    label: string;
    sessionKey: string;
  }) => void;
  /** 任务列表首次展开行数上限；undefined = 展示全部子项 */
  maxVisibleEntries?: number;
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
  const visibleEntries = maxVisibleEntries === undefined ? entries : entries.slice(0, maxVisibleEntries);

  const activeEntryId = useMemo(() => {
    const m = matchPath({ path: '/tasks/:taskId/:entryId', end: true }, pathname);
    return m?.params.taskId === taskId && m.params.entryId ? m.params.entryId : null;
  }, [pathname, taskId]);

  const hasUnreadSubitem = useMemo(() => {
    if (entries.length === 0) return false;
    for (const entryId of entries) {
      if (entryId === activeEntryId) continue;
      const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
      const activity = sk ? (sessionLastActivity[sk] ?? 0) : 0;
      if (isSubitemUnread(taskId, entryId, activity)) return true;
    }
    return false;
  }, [entries, taskId, activeEntryId, sessionKeyBySubitem, sessionLastActivity, isSubitemUnread]);

  // Only ensure subitems on mount and when taskId changes
  // Avoid calling ensureSubitem on every entries change to prevent infinite loop
  useLayoutEffect(() => {
    for (const entryId of entries) {
      ensureSubitem(taskId, entryId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]); // Only depend on taskId, not entries
  const underTask = pathname.startsWith(`/tasks/${taskId}`);

  useEffect(() => {
    if (underTask) onRequestExpand();
  }, [underTask, onRequestExpand]);

  const overviewTo = taskOverviewPath(taskId);

  if (entries.length === 0) {
    return (
      <NavLink
        to={overviewTo}
        className={cn(SIDEBAR_TASK_GROUP_ROW_CLASS, 'transition-colors')}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList className={cn('h-4 w-4 shrink-0', sidebarTextIconClass)} aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>{label}</span>
        </span>
        {hasUnreadSubitem ? (
          <span
            className={sidebarUnreadDotClass}
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
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn('group/sto-task-row', SIDEBAR_TASK_GROUP_ROW_CLASS)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList className={cn('h-4 w-4 shrink-0', sidebarTextIconClass)} aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {hasUnreadSubitem ? (
            <span
              className={sidebarUnreadDotClass}
              aria-label={tTasks('unreadBadge', { defaultValue: 'Unread' })}
            />
          ) : null}
          {SIDEBAR_SHOW_TASK_GROUP_CHEVRON ? (
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 transition-transform',
                sidebarTextIconClass,
                isOpen ? 'rotate-180' : '',
              )}
              aria-hidden
              strokeWidth={2}
            />
          ) : null}
        </span>
      </button>
      {isOpen && visibleEntries.length > 0 ? (
        <div
          id={panelId}
          className={SIDEBAR_TASK_SUBITEMS_CONTAINER_CLASS}
          role="region"
          aria-labelledby={`sto-sidebar-task-${taskId}-toggle`}
        >
          <SidebarTaskDateLinks
            taskId={taskId}
            entries={visibleEntries}
            onRequestDeleteSubitem={onRequestDeleteSubitem}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 侧栏定时任务分组：按任务名折叠，子项为每次执行的会话（日期命名）。 */
function SidebarScheduledTaskGroup({
  name,
  sessions,
  isOpen,
  onToggle,
  onRequestDelete,
  maxVisibleSessions,
}: {
  name: string;
  sessions: Array<{ key: string; label?: string; displayName?: string; updatedAt?: number }>;
  isOpen: boolean;
  onToggle: () => void;
  onRequestDelete: (payload: { key: string; label: string }) => void;
  /** 任务列表首次展开行数上限；undefined = 展示全部子项 */
  maxVisibleSessions?: number;
}) {
  const { switchSession, currentSessionKey } = useChatStore();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const runtimeBySessionKey = useChatStore((s) => s.runtimeBySessionKey);
  const isSending = useChatStore((s) => s.sending);

  if (sessions.length === 0) return null;

  const visibleSessions = maxVisibleSessions === undefined ? sessions : sessions.slice(0, maxVisibleSessions);

  // Strip common prefixes from group name for cleaner display
  const displayName = name.replace(/^Cron:\s*/i, '').replace(/^定时任务\s*/i, '');

  // 按日期统计当天会话数量，用于决定用哪种日期格式
  const dayCounts = new Map<string, number>();
  for (const s of sessions) {
    const ts = sessionLastActivity[s.key] ?? s.updatedAt ?? 0;
    if (ts > 0) {
      const d = new Date(ts);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayCounts.set(dateKey, (dayCounts.get(dateKey) ?? 0) + 1);
    }
  }

  return (
    <div className="rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn('group/sto-task-row', SIDEBAR_TASK_GROUP_ROW_CLASS)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ClipboardList className={cn('h-4 w-4 shrink-0', sidebarTextIconClass)} aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>{displayName}</span>
        </span>
        {SIDEBAR_SHOW_TASK_GROUP_CHEVRON ? (
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 transition-transform',
              sidebarTextIconClass,
              isOpen ? 'rotate-180' : '',
            )}
            aria-hidden
            strokeWidth={2}
          />
        ) : null}
      </button>
      {isOpen && visibleSessions.length > 0 ? (
        <div className={SIDEBAR_TASK_SUBITEMS_CONTAINER_CLASS}>
          {visibleSessions.map((s) => {
            const ts = sessionLastActivity[s.key] ?? s.updatedAt ?? 0;
            let label: string;
            if (ts > 0) {
              const d = new Date(ts);
              const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              const hasMultiple = (dayCounts.get(dateKey) ?? 0) > 1;
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, '0');
              const day = String(d.getDate()).padStart(2, '0');
              if (hasMultiple) {
                const h = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                const sec = String(d.getSeconds()).padStart(2, '0');
                label = `${y}年${m}月${day}日${h}时${min}分${sec}秒`; // 产品说：定时任务去掉【的材料】这3个字
              } else {
                label = `${y}年${m}月${day}日`; // 产品说：定时任务去掉【的材料】这3个字
              }
            } else {
              label = s.label || s.displayName || s.key;
            }
            const active = currentSessionKey === s.key;
            return (
              <div key={s.key} className="group relative flex w-full min-w-0 items-center">
                <button
                  type="button"
                  onClick={() => {
                    navigateToMainChatHome(navigate, location.pathname, () => switchSession(s.key));
                  }}
                  title={label}
                  className={cn(
                    'h-7 w-full min-w-0 overflow-hidden rounded-lg px-[10px] py-1 text-left transition-colors',
                    SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS,
                    active ? sidebarSubitemTextActiveClass : sidebarSubitemTextIdleClass,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {(() => {
                      const isSessionSending = runtimeBySessionKey[s.key]?.sending
                        || (s.key === currentSessionKey && isSending);
                      return isSessionSending ? (
                        <SidebarRunningIcon />
                      ) : null;
                    })()}
                  </span>
                </button>
                <SidebarTaskSubitemDeleteTrailing
                  isActive={active}
                  onDelete={() => onRequestDelete({ key: s.key, label })}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** 任务 / 工作台 / 最近：标题 chevron 常显 + sticky 钉住（docs/侧边栏改造 §5.2/5.6） */
function SidebarCollapsibleSectionLabel({
  open,
  onToggle,
  label,
  toggleAriaLabel,
  className,
  shellRef,
  stickyTopClass,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  toggleAriaLabel: string;
  /** 分区标题与上方区块间距，默认 mt-4（导航→首分区）；次分区可收紧 */
  className?: string;
  /** sticky 外壳 ref（任务区 scroll-collapse 检测用） */
  shellRef?: React.RefObject<HTMLDivElement | null>;
  /** sticky 叠层 + top 偏移（任务 / 最近分层吸顶） */
  stickyTopClass?: string;
}) {
  return (
    <div
      ref={shellRef}
      className={cn(
        sidebarSectionStickyShellClass,
        stickyTopClass ?? sidebarSectionStickyTopTaskClass,
        'mt-4',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={toggleAriaLabel}
        onClick={onToggle}
        className={cn(
          'group/sto-sidebar-section-toggle flex h-[30px] w-full items-center rounded-lg px-[10px] py-[5px] text-left outline-none ring-offset-2 transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)] focus-visible:ring-2 focus-visible:ring-ring',
          sidebarSectionLabelClass,
        )}
      >
        <span className="inline-flex min-w-0 max-w-full items-center gap-1">
          <span className="min-w-0 truncate">{label}</span>
          <span className={sidebarSectionChevronClass} aria-hidden>
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
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
  onClick,
  isActiveOverride,
  badge,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onClick?: () => void;
  isActiveOverride?: boolean;
  badge?: ReactNode;
}) {
  const { pathname } = useLocation();
  // 使用路径匹配生成 className（字符串），避免 TooltipTrigger asChild 与 NavLink 的函数 className 合并时被破坏，导致选中态不生效。
  const isActive = isActiveOverride !== undefined
    ? isActiveOverride
    : matchPath({ path: to, end: Boolean(end), caseSensitive: false }, pathname) != null;

  const linkClassName = cn(
    'relative flex items-center transition-[color,background-color,border-radius] duration-200 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
    collapsed
      ? cn(
          'mx-auto box-border min-h-0 shrink-0 justify-center gap-0 rounded-[8px] text-sm font-normal leading-5',
          'h-[var(--sto-sidebar-collapsed-nav-item-h)] w-[var(--sto-sidebar-collapsed-nav-item-w)] max-w-[calc(100%-10px)] py-[var(--sto-sidebar-collapsed-nav-py)] px-[var(--sto-sidebar-collapsed-nav-px)]',
          isActive
            ? 'bg-[var(--sto-brand-6)] text-white shadow-sm hover:bg-[#ff8d2a] active:bg-[#d95700] [&_svg]:stroke-white dark:bg-[var(--sto-brand-6)] dark:text-white dark:hover:bg-[#ff8d2a]'
            : 'text-[var(--sto-sidebar-collapsed-nav-icon-idle)] [&_svg]:stroke-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]',
        )
      : cn(
          'shrink-0 gap-[10px] text-sm leading-5',
          isActive ? sidebarNavExpandedActiveClass : sidebarNavExpandedIdleClass,
        ),
  );

  const link = (
    <NavLink to={to} end={end} className={linkClassName} onClick={onClick}>
      <span className="flex shrink-0 items-center justify-center">{icon}</span>
      {!collapsed ? (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      ) : null}
      {badge}
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
  const deleteSession = useChatStore((s) => s.deleteSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadHistory = useChatStore((s) => s.loadHistory);
  const removeSubitem = useStoTaskSubitemsStore((s) => s.removeSubitem);

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
  const isOnHome = location.pathname === '/';

  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const workflowEditorActive = useWorkflowUiStore((s) => s.editorActive);
  const sidebarExpandedBeforeWorkflowRef = useRef<boolean | null>(null);
  const [taskListSectionOpen, setTaskListSectionOpen] = useState(true);
  const [taskListShowAll, setTaskListShowAll] = useState(false);
  /** 任务组手风琴：null = 全收起；同时仅一个 groupKey 展开 */
  const [expandedTaskGroupKey, setExpandedTaskGroupKey] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(true);
  const [workspaceSectionOpen, setWorkspaceSectionOpen] = useState(true);
  const [bucketOpen, setBucketOpen] = useState<Record<SessionBucketKey, boolean>>({
    today: true,
    yesterday: true,
    withinWeek: true,
    withinTwoWeeks: true,
    withinMonth: true,
    older: true,
    cronTasks: true,
  });
  const [bucketVisibleCounts, setBucketVisibleCounts] = useState<Partial<Record<SessionBucketKey, number>>>({});
  const [recentVisibleCount, setRecentVisibleCount] = useState<number | undefined>(undefined);

  const { t } = useTranslation(['common', 'chat', 'auth', 'tasks']);

  const sidebarLayoutVariant = useMemo(() => getSidebarLayoutVariant(), []);
  const isProvincialSidebar = sidebarLayoutVariant === 'provincial';
  const isProvincialFullyHidden = isProvincialSidebar && sidebarCollapsed;
  const sidebarVis = useMemo(() => getSidebarVisibility(sidebarLayoutVariant), [sidebarLayoutVariant]);

  useEffect(() => {
    if (workflowEditorActive) {
      const prev = useSettingsStore.getState().sidebarCollapsed;
      if (sidebarExpandedBeforeWorkflowRef.current === null) {
        sidebarExpandedBeforeWorkflowRef.current = !prev;
      }
      if (!prev) setSidebarCollapsed(true);
      return;
    }
    if (sidebarExpandedBeforeWorkflowRef.current !== null) {
      const restoreExpanded = sidebarExpandedBeforeWorkflowRef.current;
      sidebarExpandedBeforeWorkflowRef.current = null;
      setSidebarCollapsed(!restoreExpanded);
    }
  }, [workflowEditorActive, setSidebarCollapsed]);

  useEffect(() => {
    if (!taskListSectionOpen) {
      setTaskListShowAll(false);
    }
  }, [taskListSectionOpen]);

  const handleCollapseTaskSectionFromScroll = useCallback(() => {
    setTaskListSectionOpen(false);
  }, []);

  const {
    scrollContainerRef,
    taskSectionHeaderRef,
    recentSectionSentinelRef,
  } = useSidebarTaskScrollCollapse({
    enabled: !sidebarCollapsed && taskListSectionOpen && recentOpen,
    taskListSectionOpen,
    onCollapseTaskSection: handleCollapseTaskSectionFromScroll,
  });

  useEffect(() => {
    if (!isGatewayRunning) return;
    let cancelled = false;
    (async () => {
      await loadSessions();
      if (cancelled) return;

      // 主页路径只需要会话列表用于侧边栏展示，不需要在启动时尝试恢复当前历史，
      // 否则会把默认 main 会话继续绑定到 OpenClaw 启动态。
      if (window.location.pathname === '/') {
        const state = useChatStore.getState();
        // Preserve locally-created sessions (workflow run, skill use, etc.) awaiting first send.
        if (isTemporaryAgentSessionKey(state.currentSessionKey)) {
          return;
        }
        if (state.currentSessionKey !== DEFAULT_SESSION_KEY || state.messages.length > 0 || state.loading) {
          const nextRuntimeBySessionKey = {
            ...state.runtimeBySessionKey,
            [state.currentSessionKey]: {
              sending: state.sending,
              activeRunId: state.activeRunId,
              streamingText: state.streamingText,
              streamingMessage: state.streamingMessage,
              streamingTools: state.streamingTools,
              pendingFinal: state.pendingFinal,
              lastUserMessageAt: state.lastUserMessageAt,
              pendingToolImages: state.pendingToolImages,
              error: state.error,
              updatedAt: Date.now(),
            },
            [DEFAULT_SESSION_KEY]: {
              sending: false,
              activeRunId: null,
              streamingText: '',
              streamingMessage: null,
              streamingTools: [],
              pendingFinal: false,
              lastUserMessageAt: null,
              pendingToolImages: [],
              error: null,
              updatedAt: Date.now(),
            },
          };
          useChatStore.setState({
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: 'main',
            runtimeBySessionKey: nextRuntimeBySessionKey,
            messages: [],
            loading: false,
            sending: false,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            activeRunId: null,
            error: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
        }
        return;
      }

      const state = useChatStore.getState();
      const currentSession = state.sessions.find((session) => session.key === state.currentSessionKey);
      const shouldLoadHistory = isGatewayRunning || currentSession?.engineType === 'claude';
      if (!shouldLoadHistory) {
        return;
      }

      const hasExistingMessages = state.messages.length > 0;
      await loadHistory(hasExistingMessages);
    })();
    return () => {
      cancelled = true;
    };
  }, [isGatewayRunning, loadHistory, loadSessions]);

  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) =>
      resolveSessionLabel({ key, displayName, label, sessionLabels, t }),
    [sessionLabels, t],
  );

  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(null);
  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
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
    () => sessions.filter((session) => !isSidebarHiddenChatSessionKey(session.key)),
    [sessions],
  );

  // Legacy cron + scheduled-task agent + Claude task (base, dated, run) sessions — shown under "任务列表" grouped by task name
  const taskListScheduledSessions = useMemo(
    () => visibleSessions.filter((s) => (
      isAnyCronSessionKey(s.key)
      || parseScheduledTaskAgentSessionKey(s.key)
      || parseClaudeScheduledTaskRunSessionKey(s.key)
      || parseClaudeScheduledTaskSessionKey(s.key) != null  // covers base & dated
    )),
    [visibleSessions],
  );

  // Normal chat sessions — shown under time buckets (today / yesterday / ...)
  const normalSessions = useMemo(
    () => visibleSessions.filter((s) => (
      !isAnyCronSessionKey(s.key)
      && !parseScheduledTaskAgentSessionKey(s.key)
      && !parseClaudeScheduledTaskRunSessionKey(s.key)
      && !parseClaudeScheduledTaskSessionKey(s.key)  // excludes base & dated
    )),
    [visibleSessions],
  );

  const getEffectiveActivityMs = (session: { key: string; updatedAt?: number; label?: string }): number => {
    const sessionKey = session.key;
    const recorded = sessionLastActivity[sessionKey] ?? 0;
    const listed = typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) ? session.updatedAt : 0;
    const activity = Math.max(recorded, listed);
    if (activity > 0) return activity;
    const isFreshCurrentSession = sessionKey === currentSessionKey
      && isTemporaryAgentSessionKey(sessionKey)
      && !sessionLabels[sessionKey];
    return isFreshCurrentSession ? nowMs : 0;
  };

  const recentSessionsSorted = useMemo(
    () => [...normalSessions].sort((a, b) => {
      const activityDiff = getEffectiveActivityMs(b) - getEffectiveActivityMs(a);
      if (activityDiff !== 0) return activityDiff;
      return b.key.localeCompare(a.key);
    }),
    // getEffectiveActivityMs 依赖 sessionLastActivity / currentSessionKey / sessionLabels / nowMs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalSessions, sessionLastActivity, currentSessionKey, sessionLabels, nowMs],
  );

  // Legacy 日期分桶：折叠轨与潜在回滚仍可能读取 bucket 数据
  for (const session of recentSessionsSorted) {
    const bucketKey = getSessionBucket(getEffectiveActivityMs(session), nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const sessionsOrderedForCollapse = recentSessionsSorted.slice(0, SIDEBAR_COLLAPSED_SESSION_LIMIT);

  // Group scheduled-task sessions by task name for the task-list section
  const scheduledTaskGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; sessions: typeof visibleSessions }>();

    for (const session of taskListScheduledSessions) {
      const stParsed = parseScheduledTaskAgentSessionKey(session.key);
      const cronParsed = parseCronSessionKey(session.key);
      const claudeTaskRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
      const claudeTaskDatedParsed = parseClaudeScheduledTaskSessionKey(session.key);

      if (stParsed) {
        const taskName = session.displayName || session.label?.split(' - ')[0] || `定时任务 ${stParsed.taskId}`;
        const groupKey = `st:${stParsed.taskId}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { key: groupKey, name: taskName, sessions: [] });
        }
        groups.get(groupKey)!.sessions.push(session);
      } else if (cronParsed) {
        const jobName = session.displayName || session.label || `定时任务 ${cronParsed.jobId}`;
        const groupKey = `cron:${cronParsed.jobId}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { key: groupKey, name: jobName, sessions: [] });
        }
        groups.get(groupKey)!.sessions.push(session);
      } else if (claudeTaskDatedParsed) {
        // Claude task session: covers base (claude-task:{taskId}), dated (claude-task:{taskId}:{date}), and any future variants
        const taskName = session.displayName || session.label || `Claude 定时任务 ${claudeTaskDatedParsed.taskId}`;
        const groupKey = `claude-task:${claudeTaskDatedParsed.taskId}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { key: groupKey, name: taskName, sessions: [] });
        }
        groups.get(groupKey)!.sessions.push(session);
      } else if (claudeTaskRunParsed) {
        const taskName = session.displayName || session.label || `Claude 定时任务 ${claudeTaskRunParsed.taskId}`;
        const groupKey = `claude-task:${claudeTaskRunParsed.taskId}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, { key: groupKey, name: taskName, sessions: [] });
        }
        groups.get(groupKey)!.sessions.push(session);
      }
    }

    // Sort sessions within each group by activity desc
    for (const group of groups.values()) {
      group.sessions.sort((a, b) => {
        const aAct = sessionLastActivity[a.key] ?? a.updatedAt ?? 0;
        const bAct = sessionLastActivity[b.key] ?? b.updatedAt ?? 0;
        return bAct - aAct;
      });
    }

    return Array.from(groups.values());
  }, [taskListScheduledSessions, sessionLastActivity]);

  const taskListRenderPlan = useMemo(
    () => buildTaskListRenderPlan(scheduledTaskGroups, taskListShowAll),
    [scheduledTaskGroups, taskListShowAll],
  );
  const showTaskListExpandAll =
    taskListSectionOpen
    && !taskListShowAll
    && taskListRenderPlan.totalRows > SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT;

  const handleTaskGroupToggle = (groupKey: string) => {
    setExpandedTaskGroupKey((prev) => (prev === groupKey ? null : groupKey));
  };

  const handleTaskGroupExpand = (groupKey: string) => {
    setExpandedTaskGroupKey(groupKey);
  };

  const toggleBucket = (key: SessionBucketKey) => {
    setBucketOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getBucketVisibleCount = (key: SessionBucketKey) =>
    bucketVisibleCounts[key] ?? SIDEBAR_BUCKET_INITIAL_LIMIT;

  const showMoreBucketSessions = (key: SessionBucketKey) => {
    setBucketVisibleCounts((prev) => ({
      ...prev,
      [key]: (prev[key] ?? SIDEBAR_BUCKET_INITIAL_LIMIT) + SIDEBAR_BUCKET_LOAD_MORE_COUNT,
    }));
  };

  const getRecentVisibleCount = () => recentVisibleCount ?? SIDEBAR_BUCKET_INITIAL_LIMIT;

  const showMoreRecentSessions = () => {
    setRecentVisibleCount((prev) => (prev ?? SIDEBAR_BUCKET_INITIAL_LIMIT) + SIDEBAR_BUCKET_LOAD_MORE_COUNT);
  };

  const primaryNav = useMemo(() => {
    const all: Array<{
      to: string;
      end?: boolean;
      icon: ReactNode;
      label: string;
      badge?: ReactNode;
    }> = [
      { to: '/', end: true, icon: <MessageSquarePlus className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.newChat') },
      { to: '/scheduled-tasks', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: `${t('common:sidebar.cronTasks')}（云）` },
      { to: '/my-tasks', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.myTasks') },
      { to: '/cron', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.cronTasks') },
      { to: '/skills', icon: <Puzzle className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.skills') },
      { to: '/workflow', icon: <Workflow className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.workflow') },
      { to: '/models', icon: <BarChart3 className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.myData') },
    ];
    return all.filter((item) => {
      if (item.to === '/models' && !sidebarVis.primaryMyData) return false;
      if (item.to === '/scheduled-tasks' && getCurrentEnvConfig().isProduction) return false;
      if (item.to === '/cron' && getCurrentEnvConfig().isProduction) return false;
      return true;
    });
  }, [sidebarVis.primaryMyData, t]);

  const workspaceNav = [
    { to: '/agents', icon: <Bot className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.agents') },
    { to: '/channels', icon: <Radio className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.channels') },
    { to: '/subscriptions', icon: <Bookmark className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.subscriptions') },
  ];

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col bg-[var(--sto-sidebar-bg)] transition-[width,border-color] duration-200 ease-out',
        isProvincialFullyHidden
          ? 'pointer-events-none w-0 overflow-hidden border-r-0'
          : cn(
              !isProvincialSidebar && 'border-r border-[var(--sto-sidebar-border)]',
              sidebarCollapsed ? 'w-[var(--sto-sidebar-w-collapsed)]' : 'w-[var(--sto-sidebar-w-expanded)]',
            ),
      )}
      aria-hidden={isProvincialFullyHidden}
    >
      {!isProvincialFullyHidden ? (
        <>
      {sidebarCollapsed ? (
        <div className="flex shrink-0 flex-col items-center border-b border-transparent px-2 pb-2 pt-3">
          <button
            type="button"
            aria-expanded={false}
            aria-label={t('common:sidebar.toggleSidebarExpand')}
            title={t('common:sidebar.toggleSidebarExpand')}
            onClick={() => setSidebarCollapsed(false)}
            className={SIDEBAR_COLLAPSED_EXPAND_BTN_CLASS}
          >
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : (
        <SidebarBrandHeader
          layoutVariant={sidebarLayoutVariant}
          onCollapse={() => setSidebarCollapsed(true)}
          collapseLabel={t('common:sidebar.toggleSidebarCollapse')}
          expandLabel={t('common:sidebar.toggleSidebarExpand')}
        />
      )}

      <nav
        className={cn(
          'flex shrink-0 flex-col gap-0.5 overflow-x-hidden pb-2',
          sidebarCollapsed ? 'px-0 pt-2' : 'px-2 pt-2',
        )}
      >
        {/* 固定区：新对话、定时任务、技能广场、工作区等 */}
        <div className="flex shrink-0 flex-col gap-0.5">
        <div className={cn('flex flex-col gap-0.5', sidebarCollapsed && 'mt-2')}>
{primaryNav.map((item) => {
  // 当有选中非默认会话时，新对话入口不高亮，避免与会话列表项同时高亮
  const shouldDimHome = currentSessionKey && currentSessionKey !== DEFAULT_SESSION_KEY;
  const homeIsActiveOverride = item.to === '/' && shouldDimHome ? false : undefined;
  
  // 点击新对话时，切换到默认会话并清空消息，让页面显示初始内容
  const handleHomeClick = item.to === '/'
    ? () => {
        const {
          messages,
          currentSessionKey: currKey,
          loading,
          sending,
          activeRunId,
          streamingText,
          streamingMessage,
          streamingTools,
          pendingFinal,
          lastUserMessageAt,
          pendingToolImages,
          error,
          runtimeBySessionKey,
        } = useChatStore.getState();
        if (messages.length > 0 || currKey !== DEFAULT_SESSION_KEY || loading) {
          const nextRuntimeBySessionKey = {
            ...runtimeBySessionKey,
            [currKey]: {
              sending,
              activeRunId,
              streamingText,
              streamingMessage,
              streamingTools,
              pendingFinal,
              lastUserMessageAt,
              pendingToolImages,
              error,
              updatedAt: Date.now(),
            },
            [DEFAULT_SESSION_KEY]: {
              sending: false,
              activeRunId: null,
              streamingText: '',
              streamingMessage: null,
              streamingTools: [],
              pendingFinal: false,
              lastUserMessageAt: null,
              pendingToolImages: [],
              error: null,
              updatedAt: Date.now(),
            },
          };
          useChatStore.setState({
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: 'main',
            runtimeBySessionKey: nextRuntimeBySessionKey,
            messages: [],
            loading: false,
            sending: false,
            streamingText: '',
            streamingMessage: null,
            streamingTools: [],
            activeRunId: null,
            error: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
          });
        }
      }
    : undefined;
  
  return (
    <SidebarNavLink
      key={item.to}
      to={item.to}
      end={item.end}
      icon={item.icon}
      label={item.label}
      collapsed={sidebarCollapsed}
      onClick={item.to === '/' ? handleHomeClick : undefined}
      isActiveOverride={homeIsActiveOverride}
      badge={item.badge}
    />
  );
})}
        </div>

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
        </div>
      </nav>

      <div
        ref={scrollContainerRef}
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden',
          sidebarCollapsed ? 'px-0' : 'px-2',
        )}
      >
        {!sidebarCollapsed ? (
          <SidebarCollapsibleSectionLabel
            shellRef={taskSectionHeaderRef}
            stickyTopClass={sidebarSectionStickyTopTaskClass}
            open={taskListSectionOpen}
            onToggle={() => setTaskListSectionOpen((o) => !o)}
            label={t('common:sidebar.taskList')}
            toggleAriaLabel={t('common:sidebar.toggleTaskListSection')}
          />
        ) : null}
        {!sidebarCollapsed && taskListSectionOpen ? (
          <div className={cn('relative z-0 mt-1 flex flex-col gap-0.5', sidebarScrollListClass)}>
            {taskListRenderPlan.items.map((item) =>
              item.kind === 'sto' ? (
                <SidebarTaskGroup
                  key={item.navItem.id}
                  taskId={item.navItem.id}
                  label={t(`common:sidebar.${item.navItem.labelKey}`)}
                  isOpen={expandedTaskGroupKey === stoTaskSidebarGroupKey(item.navItem.id)}
                  onToggle={() => handleTaskGroupToggle(stoTaskSidebarGroupKey(item.navItem.id))}
                  onRequestExpand={() => handleTaskGroupExpand(stoTaskSidebarGroupKey(item.navItem.id))}
                  onRequestDeleteSubitem={setSubitemToDelete}
                  maxVisibleEntries={item.maxVisibleEntries}
                />
              ) : (
                <SidebarScheduledTaskGroup
                  key={item.group.key}
                  name={item.group.name}
                  sessions={item.group.sessions}
                  isOpen={expandedTaskGroupKey === scheduledTaskSidebarGroupKey(item.group.key)}
                  onToggle={() => handleTaskGroupToggle(scheduledTaskSidebarGroupKey(item.group.key))}
                  onRequestDelete={(payload) => setSessionToDelete(payload)}
                  maxVisibleSessions={item.maxVisibleSessions}
                />
              ),
            )}
            {showTaskListExpandAll ? (
              <button
                type="button"
                onClick={() => setTaskListShowAll(true)}
                className={cn('mt-1 w-full rounded-[8px] px-[10px] py-[6px] text-left', sidebarMetaLinkClass)}
              >
                {t('common:sidebar.expandAllTaskList')}
              </button>
            ) : null}
          </div>
        ) : null}

        {!sidebarCollapsed ? (
          <div
            ref={recentSectionSentinelRef}
            className="pointer-events-none h-px w-full shrink-0 opacity-0"
            aria-hidden
          />
        ) : null}

        {!sidebarCollapsed ? (
          <SidebarCollapsibleSectionLabel
            stickyTopClass={sidebarSectionStickyTopRecentClass}
            open={recentOpen}
            onToggle={() => setRecentOpen((o) => !o)}
            label={t('common:sidebar.recent')}
            toggleAriaLabel={t('common:sidebar.toggleRecentSection')}
            className="mt-2"
          />
        ) : null}

        <div
          className={cn(
            sidebarScrollListClass,
            'space-y-1 pb-2',
            sidebarCollapsed ? 'pt-1' : recentOpen ? 'pt-1' : 'pt-0',
          )}
        >
          {sidebarCollapsed && sessionsOrderedForCollapse.length > 0 ? (
            <div className="flex flex-col gap-1">
              {sessionsOrderedForCollapse.map((s) => {
                const full = getSessionLabel(s.key, s.displayName, s.label);
                const short = collapsedEntryLabel(full);
                const active = isOnHome && currentSessionKey === s.key && currentSessionKey !== DEFAULT_SESSION_KEY;
                return (
                  <Tooltip key={s.key} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          navigateToMainChatHome(navigate, location.pathname, () => switchSession(s.key));
                        }}
                        className={cn(
                          'relative mx-auto flex min-h-0 min-w-0 items-center justify-center rounded-[8px] font-normal leading-5 transition-colors',
                          'h-[var(--sto-sidebar-collapsed-nav-item-h)] w-[var(--sto-sidebar-collapsed-nav-item-w)] max-w-[calc(100%-10px)] py-[var(--sto-sidebar-collapsed-nav-py)] px-[var(--sto-sidebar-collapsed-nav-px)] text-sm',
                          active
                            ? 'bg-[var(--sto-brand-6)] text-white shadow-sm hover:bg-[#ff8d2a] dark:bg-[var(--sto-brand-6)]'
                            : 'text-[var(--sto-sidebar-collapsed-nav-icon-idle)] hover:bg-[var(--sto-sidebar-row-hover-bg)]',
                        )}
                      >
                        <span className="truncate">{short}</span>
                        <span className="pointer-events-none absolute right-1 top-0.5">
                          <SidebarRecentSessionStatus sessionKey={s.key} isCompact />
                        </span>
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
            (recentSessionsSorted.length === 0 ? (
              <p className={cn('px-2 pt-2 text-center text-sm leading-5 opacity-80', sidebarTextSectionClass)}>
                {t('common:sidebar.emptyChatHistory')}
              </p>
            ) : recentOpen ? (
              <>
                {/* Legacy 按日期分桶 UI — 保留供回滚，默认关闭 */}
                {USE_LEGACY_SESSION_DATE_BUCKETS
                  ? sessionBuckets.map((bucket) =>
                      bucket.sessions.length > 0 ? (
                        <div key={bucket.key} className="rounded-lg">
                          <button
                            type="button"
                            onClick={() => toggleBucket(bucket.key)}
                            className={cn(
                              'flex w-full items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.08]',
                              sidebarSectionLabelClass,
                            )}
                          >
                            <span className="truncate">{bucket.label}</span>
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 shrink-0 transition-transform',
                                bucketOpen[bucket.key] ? 'rotate-180' : '',
                              )}
                              aria-hidden
                            />
                          </button>
                          {bucketOpen[bucket.key] ? (
                            <>
                              {bucket.sessions.slice(0, getBucketVisibleCount(bucket.key)).map((s) => {
                                const isEditing = editingSessionKey === s.key;
                                const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
                                const isRecentSessionActive =
                                  isOnHome && currentSessionKey === s.key && currentSessionKey !== DEFAULT_SESSION_KEY;
                                return (
                                  <div key={s.key} className="group relative flex w-full min-w-0 items-center">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        autoFocus
                                        value={editingValue}
                                        onChange={(e) => setEditingValue(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            renameSession(s.key, editingValue);
                                            setEditingSessionKey(null);
                                          } else if (e.key === 'Escape') {
                                            setEditingSessionKey(null);
                                          }
                                        }}
                                        onBlur={() => {
                                          renameSession(s.key, editingValue);
                                          setEditingSessionKey(null);
                                        }}
                                        className={cn(
                                          'w-full rounded-[8px] px-[10px] py-[6px] pr-16 text-left text-sm leading-5 transition-colors outline-none',
                                          'bg-white border border-[var(--sto-brand-6)] text-foreground dark:bg-card',
                                        )}
                                      />
                                    ) : (
                                      <>
                                        <div
                                          className={cn(
                                            'relative flex h-9 w-full items-center rounded-lg transition-colors',
                                            isRecentSessionActive
                                              ? cn(
                                                  sidebarSubitemTextActiveClass,
                                                  'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
                                                )
                                              : sidebarSubitemTextIdleClass,
                                          )}
                                        >
                                          <button
                                            type="button"
                                            onClick={() => {
                                              navigateToMainChatHome(navigate, location.pathname, () => switchSession(s.key));
                                            }}
                                            title={sessionLabel}
                                            className="flex h-9 min-w-0 w-full flex-1 items-center overflow-hidden rounded-lg bg-transparent px-[10px] py-2 pr-12 text-left"
                                          >
                                            <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>
                                              {sessionLabel}
                                            </span>
                                          </button>
                                          <SidebarRecentSessionRowTrailing
                                            sessionKey={s.key}
                                            isActive={isRecentSessionActive}
                                            onEdit={() => {
                                              setEditingSessionKey(s.key);
                                              setEditingValue(sessionLabel);
                                            }}
                                            onDelete={() => {
                                              setSessionToDelete({
                                                key: s.key,
                                                label: sessionLabel,
                                              });
                                            }}
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                              {bucket.sessions.length > getBucketVisibleCount(bucket.key) ? (
                                <button
                                  type="button"
                                  onClick={() => showMoreBucketSessions(bucket.key)}
                                  className={cn('mt-1 w-full rounded-[8px] px-[10px] py-[6px] text-left', sidebarMetaLinkClass)}
                                >
                                  {t('common:actions.showMore', {
                                    defaultValue: '显示更多（{{count}}）',
                                    count: bucket.sessions.length - getBucketVisibleCount(bucket.key),
                                  })}
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null,
                    )
                  : null}
                {recentSessionsSorted.slice(0, getRecentVisibleCount()).map((s) => {
                  const isEditing = editingSessionKey === s.key;
                  const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
                  const isRecentSessionActive =
                    isOnHome && currentSessionKey === s.key && currentSessionKey !== DEFAULT_SESSION_KEY;
                  return (
                    <div key={s.key} className="relative flex w-full min-w-0 items-center">
                      {isEditing ? (
                        <input
                          type="text"
                          autoFocus
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameSession(s.key, editingValue);
                              setEditingSessionKey(null);
                            } else if (e.key === 'Escape') {
                              setEditingSessionKey(null);
                            }
                          }}
                          onBlur={() => {
                            renameSession(s.key, editingValue);
                            setEditingSessionKey(null);
                          }}
                          className={cn(
                            'w-full rounded-[8px] px-[10px] py-[6px] pr-16 text-left text-sm leading-5 transition-colors outline-none',
                            'bg-white border border-[var(--sto-brand-6)] text-foreground dark:bg-card',
                          )}
                        />
                      ) : (
                        <div
                          className={cn(
                            'group relative flex h-9 w-full items-center rounded-lg transition-colors',
                            isRecentSessionActive
                              ? cn(
                                  sidebarSubitemTextActiveClass,
                                  'hover:bg-[var(--sto-sidebar-row-hover-bg)]',
                                )
                              : sidebarSubitemTextIdleClass,
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              navigateToMainChatHome(navigate, location.pathname, () => switchSession(s.key));
                            }}
                            title={sessionLabel}
                            className="flex h-9 min-w-0 w-full flex-1 items-center overflow-hidden rounded-lg bg-transparent px-[10px] py-2 pr-12 text-left"
                          >
                            <span className={cn('min-w-0 flex-1 truncate', sidebarListItemTextClass)}>
                              {sessionLabel}
                            </span>
                          </button>
                          <SidebarRecentSessionRowTrailing
                            sessionKey={s.key}
                            isActive={isRecentSessionActive}
                            onEdit={() => {
                              setEditingSessionKey(s.key);
                              setEditingValue(sessionLabel);
                            }}
                            onDelete={() => {
                              setSessionToDelete({
                                key: s.key,
                                label: sessionLabel,
                              });
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {recentSessionsSorted.length > getRecentVisibleCount() ? (
                  <button
                    type="button"
                    onClick={showMoreRecentSessions}
                    className={cn('mt-1 w-full rounded-[8px] px-[10px] py-[6px] text-left', sidebarMetaLinkClass)}
                  >
                    {t('common:actions.showMore', {
                      defaultValue: '显示更多（{{count}}）',
                      count: recentSessionsSorted.length - getRecentVisibleCount(),
                    })}
                  </button>
                ) : null}
              </>
            ) : null)}
        </div>
      </div>

      <SidebarUpdateNotice collapsed={sidebarCollapsed} />

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
                      : 'items-center justify-between gap-3 px-2 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'
                    : 'items-center justify-center rounded-[8px] p-2 hover:bg-black/[0.02] dark:hover:bg-muted/40',
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
                          <span className={sidebarFooterNameClass}>
                            {authUser.realName?.trim() || authUser.userName}
                          </span>
                          {authUser.companyName?.trim() ? (
                            <span className={sidebarFooterMetaClass}>
                              {authUser.companyName.trim()}
                            </span>
                          ) : null}
                        </div>
                        <SettingsIcon
                          className={sidebarFooterSettingsIconClass}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                      </>
                    )}
                  </>
                ) : (
                  <SettingsIcon className={sidebarFooterSettingsIconClass} strokeWidth={1.75} aria-hidden />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className={SIDEBAR_ACCOUNT_MENU_CONTENT_CLASS}
            >
              {/* 2026.6.3 暂时不显示这个信息 */}
              {/* <div className="px-2.5 py-2">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">
                    {authUser.realName?.trim() || authUser.userName}
                  </span>
                  {authUser.userName ? (
                    <span className="text-xs text-muted-foreground">
                      工号：{authUser.userName}
                    </span>
                  ) : null}
                  {(authUser.companyCode || authUser.departmentCode) ? (
                    <span className="text-xs text-muted-foreground">
                      网点代码：{authUser.companyCode || authUser.departmentCode}
                    </span>
                  ) : null}
                  {(authUser.companyName || authUser.departmentName) ? (
                    <span className="text-xs text-muted-foreground">
                      网点名称：{authUser.companyName || authUser.departmentName}
                    </span>
                  ) : null}
                  {authUser.categoryCode ? (
                    <span className="text-xs text-muted-foreground">
                      用户类别：{authUser.categoryCode}
                    </span>
                  ) : null}
                </div>
              </div>
              <DropdownMenuSeparator /> */}
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
        </>
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
          if (currentSessionKey === sessionToDelete.key) navigateToMainChatHome(navigate, location.pathname);
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
          if (currentSessionKey === sessionKey) navigateToMainChatHome(navigate, location.pathname);
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
