/**
 * Sidebar — 单列宽侧栏。
 * 省区布局：展开 260px / 收起 w-0 完全隐藏；折叠钮在侧栏列顶行（无全局顶栏）。
 * 完整布局：展开 260px / 收起 72px 图标轨。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, matchPath } from 'react-router-dom';
import {
  Wrench,
  Clock,
  Settings as SettingsIcon,
  ChevronRight,
  Bookmark,
  ClipboardList,
  MessageSquarePlus,
  BarChart3,
  Bot,
  Radio,
  ChevronDown,
  Workflow,
  Check,
  LayoutGrid,
} from 'lucide-react';
import sidebarCollapseAllGroupsIcon from '@/assets/icons/sidebar-collapse-all-groups.svg';
import sidebarExpandAllGroupsIcon from '@/assets/icons/sidebar-expand-all-groups.svg';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { getCurrentEnvConfig } from '../../../shared/env-config';
import { closeSclawBrowser, isSclawBrowserOpen } from '@/lib/open-sclaw-browser';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useAuthStore, isSiteUser } from '@/stores/auth';
import { readSessionUnread, useSessionUnreadStore } from '@/stores/session-unread';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SidebarBrandHeader } from '@/components/layout/sidebar-brand-header';
import { SidebarSupportQrTooltip } from '@/components/layout/SidebarSupportQrTooltip';
import { SidebarCollapsibleSectionLabel } from '@/components/layout/sidebar-collapsible-section-label';
import { SidebarRecentSessionStatus } from '@/components/layout/sidebar-recent-session-status';
import { SidebarRecentSessionRow } from '@/components/layout/sidebar-recent-session-row';
import { SidebarProjectsSection } from '@/components/layout/sidebar-projects-section';
import {
  isSessionInActiveWorkspace,
  useSessionCatalogStore,
} from '@/stores/session-catalog';
import { toast } from 'sonner';
import {
  SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS,
  SidebarTaskSubitemDeleteTrailing,
} from '@/components/layout/sidebar-task-subitem-delete-trailing';
import { useTranslation } from 'react-i18next';
import { resolveSessionLabel } from '@/lib/session-label';
import { sortSessionsWithCatalogPin } from '@/lib/sidebar-recent-order';
import { type StoTaskId } from '@/lib/sto-tasks';
import { navigateToMainChatHome } from '@/lib/main-chat-navigation';
import { resolveSidebarChannelSource } from '@/lib/session-channel-source';
import { DEFAULT_SESSION_KEY } from '@/stores/chat/types';
import { scheduleSessionLabelHydrationForStore } from '@/stores/chat/session-metadata-hydrate';
import { isSidebarHiddenChatSessionKey, buildBuiltinStoGroupSortSessions } from '@/lib/sto-task-session';
import {
  parseClaudeScheduledTaskSessionKey,
  parseClaudeScheduledTaskRunSessionKey,
  parseCronSessionKey,
  parseScheduledTaskAgentSessionKey,
  isAnyCronSessionKey,
  isVirtualTaskSessionKey,
} from '@/stores/chat/cron-session-utils';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { buildScheduledTaskGroupDisplayName, deriveGroupFirstTriggeredFromSessions, getSessionActivityMs, sortScheduledTaskGroupsByFirstTriggerDesc } from '@/lib/scheduled-task-group-name';
import {
  fetchTaskGroupFirstTriggeredMap,
  isTaskGroupFirstTriggerOptimisticallyCleared,
  rememberOptimisticTaskGroupFirstTriggered,
  seedTaskGroupFirstTriggeredIfAbsent,
} from '@/lib/task-group-first-trigger';
import {
  type LastSessionDeleteFirstTriggerPrep,
  prepareFirstTriggerClearBeforeLastSessionDelete,
  rememberSuppressedKeysForLastGroupSessionDelete,
  revertFirstTriggerClearAfterFailedDelete,
} from '@/lib/task-group-first-trigger-delete';
import { resolveTaskGroupKeyFromSessionKey, stoBuiltinTaskGroupKey } from '../../../shared/task-group-key';
import { useScheduledTaskNameMaps } from '@/hooks/use-scheduled-task-name-maps';
import { stoTaskSubitemKey, useStoTaskSubitemsStore } from '@/stores/sto-task-subitems';
import {
  type SidebarSubitemDeletePayload,
  useSidebarDeleteConfirmStore,
} from '@/stores/sidebar-delete-confirm';
import { getSidebarLayoutVariant, getSidebarVisibility } from '@/lib/sidebar-layout';
import {
  resolveSidebarAccountFooterMode,
  shouldRenderAccountGearIcon,
} from '@/lib/sidebar-account-footer';
import {
  appendGroupExpanded,
  areAllExpandableGroupsExpanded,
  collapseAllGroups,
  expandAllGroups,
  toggleGroupExpanded,
} from '@/lib/sidebar-section-group-expand';
import { isSidebarPrimaryNavItemVisible } from '@/lib/sidebar-primary-nav';
import { useWorkflowUiStore } from '@/stores/workflow-ui';
import {
  sidebarFooterMetaClass,
  sidebarFooterNameClass,
  sidebarAccountHelpTriggerClass,
  sidebarAccountHotzoneTriggerClass,
  sidebarFooterSettingsIconClass,
  sidebarListItemTextClass,
  sidebarMetaLinkClass,
  sidebarNavExpandedActiveClass,
  sidebarNavExpandedIdleClass,
  sidebarSectionLabelClass,
  sidebarSubitemTextActiveClass,
  sidebarSubitemTextIdleClass,
  sidebarTextIconClass,
  sidebarTextSectionClass,
  sidebarUnreadDotClass,
  sidebarSectionStickyTopProjectClass,
  sidebarSectionStickyTopTaskClass,
  sidebarSectionStickyTopRecentClass,
  sidebarScrollListClass,
  sidebarScrollContainerClass,
} from '@/lib/surfaces';
import { useSidebarSectionScrollCollapse } from '@/hooks/use-sidebar-section-scroll-collapse';

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

/** Footer account dropdown — MasterGo: 160×186 卡片 + 34px 行高菜单项 */
const SIDEBAR_ACCOUNT_MENU_CONTENT_CLASS =
  'w-[160px] min-w-[160px] max-w-[160px] rounded-[12px] border border-[#E5E6EB] bg-white p-0 py-2 shadow-lg dark:border-border dark:bg-card';
const SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS =
  'min-w-[160px] rounded-[12px] border border-[#E5E6EB] bg-white p-1 shadow-lg dark:border-border dark:bg-card';
const SIDEBAR_ACCOUNT_MENU_ITEM_CLASS =
  'h-[34px] w-full min-w-0 rounded-[6px] px-6 py-2 text-[14px] leading-[18px] text-[#1D2129] dark:text-foreground';
const SIDEBAR_ACCOUNT_MENU_LOGOUT_CLASS =
  'h-[34px] w-full min-w-0 rounded-[6px] px-6 py-2 text-[14px] font-bold leading-[18px] text-[#1D2129] dark:text-foreground';
const SIDEBAR_ACCOUNT_MENU_ITEM_HOVER =
  'hover:bg-[#F5F6F7] focus:bg-[#F5F6F7] data-[highlighted]:bg-[#F5F6F7] data-[state=open]:bg-[#F5F6F7] dark:hover:bg-muted dark:focus:bg-muted dark:data-[highlighted]:bg-muted dark:data-[state=open]:bg-muted';
const SIDEBAR_ACCOUNT_MENU_DIVIDER_CLASS = 'mx-6 my-0 h-px bg-[#E5E6EB] dark:bg-border';
/** 收起态 / provincial 紧凑设置入口：圆形 #E5E6EB 底（展开态账号热区不再用齿轮） */
const SIDEBAR_ACCOUNT_SETTINGS_TRIGGER_CLASS = cn(
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors',
  'hover:bg-[#E5E6EB] dark:hover:bg-muted',
  'data-[state=open]:bg-[#E5E6EB] dark:data-[state=open]:bg-muted',
);
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

function resolveSidebarExpandKeyForTaskGroup(groupKey: string): string {
  return groupKey.startsWith('sto:') ? groupKey : scheduledTaskSidebarGroupKey(groupKey);
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
  items: TaskListRenderItem[],
  showAll: boolean,
): { items: TaskListRenderItem[]; totalRows: number } {
  const totalRows = items.length;

  if (showAll || totalRows <= SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT) {
    return { items, totalRows };
  }

  return {
    items: items.slice(0, SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT),
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
  onRequestDeleteSubitem: (payload: SidebarSubitemDeletePayload) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation(['tasks', 'common']);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const runtimeBySessionKey = useChatStore((s) => s.runtimeBySessionKey);
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const sessionKeyBySubitem = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem);
  const isSubitemUnread = useStoTaskSubitemsStore((s) => s.isSubitemUnread);
  const markSubitemReadFromActivity = useStoTaskSubitemsStore((s) => s.markSubitemReadFromActivity);

  useEffect(() => {
    const activeEntry = entries.find((entryId) => {
      const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
      return sk === currentSessionKey;
    });
    if (!activeEntry) return;
    const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, activeEntry)] ?? '';
    if (!sk) return;
    const a = sessionLastActivity[sk] ?? 0;
    if (a > 0) markSubitemReadFromActivity(taskId, activeEntry, a);
  }, [entries, taskId, sessionKeyBySubitem, sessionLastActivity, currentSessionKey, markSubitemReadFromActivity]);

  const openSubitemSession = (entryId: string, sk: string, label: string) => {
    const chat = useChatStore.getState();
    if (!chat.sessions.some((session) => session.key === sk)) {
      useChatStore.setState((state) => ({
        sessions: [...state.sessions, { key: sk, label }],
      }));
    }
    chat.renameSession(sk, label);
    const a = chat.sessionLastActivity[sk] ?? 0;
    if (a > 0) markSubitemReadFromActivity(taskId, entryId, a);
    navigateToMainChatHome(navigate, location.pathname, () => switchSession(sk));
  };

  return (
    <>
      {entries.map((entryId) => {
        const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
        const active = Boolean(sk) && currentSessionKey === sk;
        const activity = sk ? (sessionLastActivity[sk] ?? 0) : 0;
        const runtime = sk ? runtimeBySessionKey[sk] : undefined;
        const isRunning = Boolean(
          runtime?.sending
          || runtime?.activeRunId
          || (active && (currentSessionSending || currentSessionActiveRunId)),
        );
        const hasError = Boolean(
          (runtime?.error != null && runtime.error !== '')
          || (active && currentSessionError != null && currentSessionError !== ''),
        );
        const unread = !active && !isRunning && !hasError && isSubitemUnread(taskId, entryId, activity);
        const dateLabel = formatMaterialDateFromEntryId(entryId, i18n.language);
        const label = t('tasks:sidebarMaterialTitle', { date: dateLabel });
        return (
          <div key={entryId} className="group relative flex w-full min-w-0 items-center">
            <button
              type="button"
              disabled={!sk}
              onClick={() => {
                if (!sk) return;
                openSubitemSession(entryId, sk, label);
              }}
              className={cn(
                'relative z-[1] inline-flex h-7 w-full min-w-0 max-w-full items-center overflow-hidden rounded-lg px-[10px] py-1 text-left transition-colors',
                SIDEBAR_TASK_SUBITEM_ROW_PR_CLASS,
                active ? sidebarSubitemTextActiveClass : sidebarSubitemTextIdleClass,
              )}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
            {sk ? (
              <SidebarTaskSubitemDeleteTrailing
                isActive={active}
                sessionKey={sk}
                showUnreadDot={unread}
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
  onRequestDeleteSubitem: (payload: SidebarSubitemDeletePayload) => void;
  /** 任务列表首次展开行数上限；undefined = 展示全部子项 */
  maxVisibleEntries?: number;
}) {
  const { t: tTasks } = useTranslation('tasks');
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
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
    for (const entryId of entries) {
      const sk = sessionKeyBySubitem[stoTaskSubitemKey(taskId, entryId)] ?? '';
      if (sk === currentSessionKey) return entryId;
    }
    return null;
  }, [entries, taskId, sessionKeyBySubitem, currentSessionKey]);

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
  const underTask = activeEntryId !== null;

  // 当前会话属于该任务组时自动展开（与定时任务组一致，不再依赖 /tasks 路由）。
  useEffect(() => {
    if (underTask) onRequestExpand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underTask, taskId]);

  if (entries.length === 0) {
    return null;
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
  const currentSessionSending = useChatStore((s) => s.sending);
  const currentSessionActiveRunId = useChatStore((s) => s.activeRunId);
  const currentSessionError = useChatStore((s) => s.error);
  const unreadKeys = useSessionUnreadStore((s) => s.unreadKeys);

  if (sessions.length === 0) return null;

  const visibleSessions = maxVisibleSessions === undefined ? sessions : sessions.slice(0, maxVisibleSessions);
  const hasCollapsedGroupUnread = !isOpen && sessions.some(
    (session) => session.key !== currentSessionKey
      && readSessionUnread(unreadKeys, session.key),
  );

  // Strip Gateway technical prefix only; keep user-defined names like「定时任务测试」intact.
  const displayName = name.replace(/^Cron:\s*/i, '');

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
          {hasCollapsedGroupUnread ? (
            <span className={sidebarUnreadDotClass} aria-hidden />
          ) : null}
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
            const runtime = runtimeBySessionKey[s.key];
            const isRunning = Boolean(
              runtime?.sending
              || runtime?.activeRunId
              || (active && (currentSessionSending || currentSessionActiveRunId)),
            );
            const hasError = Boolean(
              (runtime?.error != null && runtime.error !== '')
              || (active && currentSessionError != null && currentSessionError !== ''),
            );
            const showUnreadDot = !active && !isRunning && !hasError && readSessionUnread(unreadKeys, s.key);
            return (
              <div key={s.key} className="group relative flex w-full min-w-0 items-center">
                <button
                  type="button"
                  data-sidebar-task-session={s.key}
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
                  <span className="min-w-0 truncate">{label}</span>
                </button>
                <SidebarTaskSubitemDeleteTrailing
                  isActive={active}
                  sessionKey={s.key}
                  showUnreadDot={showUnreadDot}
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
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
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
  const pendingProjectId = useChatStore((s) => s.pendingProjectId);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const runtimeBySessionKey = useChatStore((s) => s.runtimeBySessionKey);
  const sending = useChatStore((s) => s.sending);
  const activatingScheduledSessionAt = useChatStore((s) => s.activatingScheduledSessionAt);
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
  const siteDepartmentTypes = useAuthStore((s) => s.siteDepartmentTypes);
  const isSite =
    siteDepartmentTypes !== null && isSiteUser(authUser?.categoryCode);

  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const location = useLocation();
  const navigate = useNavigate();
  const isOnHome = location.pathname === '/';

  const handleSidebarPointerDownCapture = useCallback(() => {
    if (isSclawBrowserOpen()) {
      closeSclawBrowser();
    }
  }, []);

  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((s) => s.setSidebarCollapsed);
  const workflowEditorActive = useWorkflowUiStore((s) => s.editorActive);
  const sidebarExpandedBeforeWorkflowRef = useRef<boolean | null>(null);
  const [taskListSectionOpen, setTaskListSectionOpen] = useState(true);
  const [taskListShowAll, setTaskListShowAll] = useState(false);
  const [taskGroupFirstTriggeredAt, setTaskGroupFirstTriggeredAt] = useState<Record<string, number>>({});
  const scheduledTaskNameMaps = useScheduledTaskNameMaps(!sidebarCollapsed, sessions.length);
  const stoEntriesByTask = useStoTaskSubitemsStore((s) => s.entriesByTask);
  const stoSessionKeyBySubitem = useStoTaskSubitemsStore((s) => s.sessionKeyBySubitem);
  /** 任务组多开：Record 与项目同构；模块收起不清空 */
  const [expandedTaskGroupIds, setExpandedTaskGroupIds] = useState<Record<string, boolean>>({});
  const [recentOpen, setRecentOpen] = useState(true);
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
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
  const accountFooterMode = resolveSidebarAccountFooterMode({
    userProfileCard: sidebarVis.userProfileCard,
    sidebarCollapsed,
  });
  const allCatalogByKey = useSessionCatalogStore((s) => s.allCatalogByKey);
  const sessionWorkspaceByKey = useSessionCatalogStore((s) => s.sessionWorkspaceByKey);
  const patchSessionCatalog = useSessionCatalogStore((s) => s.patchSessionCatalog);
  const catalogBootstrap = useSessionCatalogStore((s) => s.bootstrap);

  useEffect(() => {
    void catalogBootstrap().catch((error) => {
      console.error('[session-catalog] sidebar bootstrap failed', error);
    });
  }, [catalogBootstrap]);

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

  const revealTaskListAfterOpenRef = useRef(false);
  const suppressNextTaskAutoCollapseRef = useRef(false);
  const revealProjectsAfterOpenRef = useRef(false);
  const suppressNextProjectsAutoCollapseRef = useRef(false);

  const closeTaskListSection = useCallback(() => {
    setTaskListSectionOpen(false);
    setTaskListShowAll(false);
  }, []);

  const closeProjectsSection = useCallback(() => {
    setProjectsSectionOpen(false);
  }, []);

  const toggleTaskListSection = useCallback(() => {
    if (taskListSectionOpen) {
      closeTaskListSection();
    } else {
      revealTaskListAfterOpenRef.current = true;
      suppressNextTaskAutoCollapseRef.current = true;
      setTaskListSectionOpen(true);
    }
  }, [taskListSectionOpen, closeTaskListSection]);

  const toggleProjectsSection = useCallback(() => {
    if (projectsSectionOpen) {
      closeProjectsSection();
    } else {
      revealProjectsAfterOpenRef.current = true;
      suppressNextProjectsAutoCollapseRef.current = true;
      setProjectsSectionOpen(true);
    }
  }, [projectsSectionOpen, closeProjectsSection]);

  useEffect(() => {
    if (sidebarCollapsed) return;
    void fetchTaskGroupFirstTriggeredMap().then(setTaskGroupFirstTriggeredAt);
  }, [sidebarCollapsed, sessions, stoEntriesByTask]);

  const handleCollapseTaskSectionFromScroll = useCallback(() => {
    if (suppressNextTaskAutoCollapseRef.current) return;
    closeTaskListSection();
  }, [closeTaskListSection]);

  const handleCollapseProjectsSectionFromScroll = useCallback(() => {
    if (suppressNextProjectsAutoCollapseRef.current) return;
    closeProjectsSection();
  }, [closeProjectsSection]);

  const {
    scrollContainerRef,
    projectSectionHeaderRef,
    taskSectionHeaderRef,
    recentSectionSentinelRef,
  } = useSidebarSectionScrollCollapse({
    enabled: !sidebarCollapsed && (projectsSectionOpen || taskListSectionOpen),
    projectsSectionOpen,
    taskListSectionOpen,
    onCollapseProjectsSection: handleCollapseProjectsSectionFromScroll,
    onCollapseTaskSection: handleCollapseTaskSectionFromScroll,
  });

  // 用户手动展开项目：按分区锚点揭示内容，并暂缓下一次自动收起
  useLayoutEffect(() => {
    if (!revealProjectsAfterOpenRef.current || !projectsSectionOpen) return;
    revealProjectsAfterOpenRef.current = false;

    const container = scrollContainerRef.current;
    const projectHeader = projectSectionHeaderRef.current;
    if (!container || !projectHeader) {
      suppressNextProjectsAutoCollapseRef.current = false;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const projectRect = projectHeader.getBoundingClientRect();
    const isStuck = projectRect.top <= containerRect.top + 1;
    if (isStuck) {
      // 揭示项目内容：滚到项目标题贴顶即可看到下方列表
      const delta = projectRect.top - containerRect.top;
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta) });
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressNextProjectsAutoCollapseRef.current = false;
      });
    });
  }, [projectsSectionOpen, scrollContainerRef, projectSectionHeaderRef]);

  // 用户手动展开任务：在项目 sticky 下方揭示任务内容，不一律 scrollTop=0
  useLayoutEffect(() => {
    if (!revealTaskListAfterOpenRef.current || !taskListSectionOpen) return;
    revealTaskListAfterOpenRef.current = false;

    const container = scrollContainerRef.current;
    const taskHeader = taskSectionHeaderRef.current;
    const projectHeader = projectSectionHeaderRef.current;
    if (!container || !taskHeader) {
      suppressNextTaskAutoCollapseRef.current = false;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const taskHeaderRect = taskHeader.getBoundingClientRect();
    const projectH = projectHeader?.getBoundingClientRect().height ?? 0;
    const stuckTop = containerRect.top + (projectsSectionOpen ? projectH : 0);
    const isTaskHeaderStuck = taskHeaderRect.top <= stuckTop + 1;

    if (isTaskHeaderStuck) {
      const targetTop = stuckTop;
      const delta = taskHeaderRect.top - targetTop;
      container.scrollTo({ top: Math.max(0, container.scrollTop + delta) });
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        suppressNextTaskAutoCollapseRef.current = false;
      });
    });
  }, [
    taskListSectionOpen,
    projectsSectionOpen,
    scrollContainerRef,
    taskSectionHeaderRef,
    projectSectionHeaderRef,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Session list (sidebar recent) must not wait for Gateway — OpenClaw can
      // fall back to sessions.json and Claude/catalog paths are Main-local.
      await loadSessions();
      if (cancelled) return;
      scheduleSessionLabelHydrationForStore(
        () => {
          const state = useChatStore.getState();
          return {
            sessions: state.sessions,
            sessionLabels: state.sessionLabels,
            sessionLastActivity: state.sessionLastActivity,
            sidebarRecentOrder: state.sidebarRecentOrder,
          };
        },
        useChatStore.setState,
      );

      // 主页路径只需要会话列表用于侧边栏展示，不需要在启动时尝试恢复当前历史，
      // 否则会把默认 main 会话继续绑定到 OpenClaw 启动态。
      // HashRouter: use React Router pathname — window.location.pathname is the HTML file path in Electron.
      if (isOnHome) {
        const state = useChatStore.getState();
        // Preserve locally-created sessions (workflow run, skill use, etc.) awaiting first send.
        if (isTemporaryAgentSessionKey(state.currentSessionKey)) {
          return;
        }
        // Task/cron execution sessions intentionally open on home chat — do not reset to :main.
        if (isVirtualTaskSessionKey(state.currentSessionKey)) {
          const hasExistingMessages = state.messages.length > 0;
          await loadHistory(hasExistingMessages);
          return;
        }
        // Home reset to :main is Gateway-era UX (avoid binding OpenClaw startup to
        // a leftover session). Skip while Gateway is down so offline sidebar browse
        // does not wipe the user's current session selection.
        if (!isGatewayRunning) {
          return;
        }
        if (state.currentSessionKey !== DEFAULT_SESSION_KEY || state.messages.length > 0 || state.loading) {
          const nextRuntimeBySessionKey = {
            ...state.runtimeBySessionKey,
            [state.currentSessionKey]: {
              sending: state.sending,
              aborting: state.runtimeBySessionKey[state.currentSessionKey]?.aborting ?? false,
              activeRunId: state.activeRunId,
              sendAcceptance: state.sendAcceptance,
              streamingText: state.streamingText,
              streamingMessage: state.streamingMessage,
              streamingMessages: state.streamingMessages,
              streamingToolResults: state.streamingToolResults,
              streamingTools: state.streamingTools,
              pendingFinal: state.pendingFinal,
              lastUserMessageAt: state.lastUserMessageAt,
              optimisticUserMessage: state.optimisticUserMessage,
              pendingToolImages: state.pendingToolImages,
              error: state.error,
              updatedAt: Date.now(),
            },
            [DEFAULT_SESSION_KEY]: {
              sending: false,
              aborting: false,
              activeRunId: null,
              sendAcceptance: null,
              streamingText: '',
              streamingMessage: null,
              streamingMessages: [],
              streamingToolResults: [],
              streamingTools: [],
              pendingFinal: false,
              lastUserMessageAt: null,
              optimisticUserMessage: null,
              pendingToolImages: [],
              error: null,
              updatedAt: Date.now(),
            },
          };
          useChatStore.setState({
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: 'main',
            pendingProjectId: null,
            runtimeBySessionKey: nextRuntimeBySessionKey,
            messages: [],
            loading: false,
            sending: false,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            activeRunId: null,
            sendAcceptance: null,
            error: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
            pendingWorkflow: null,
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
  }, [isGatewayRunning, isOnHome, loadHistory, loadSessions]);

  const getSessionLabel = useCallback(
    (key: string, displayName?: string, label?: string) =>
      resolveSessionLabel({ key, displayName, label, sessionLabels, t }),
    [sessionLabels, t],
  );

  const requestSessionDelete = useSidebarDeleteConfirmStore((s) => s.requestSessionDelete);
  const requestSubitemDelete = useSidebarDeleteConfirmStore((s) => s.requestSubitemDelete);
  const registerDeleteConfirmExecutors = useSidebarDeleteConfirmStore((s) => s.registerExecutors);

  const [editingSessionKey, setEditingSessionKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [supportQrOpen, setSupportQrOpen] = useState(false);

  const catalogByKey = allCatalogByKey;

  const renderRecentSessionRow = useCallback((s: (typeof sessions)[number]) => {
    const sessionLabel = getSessionLabel(s.key, s.displayName, s.label);
    const isRecentSessionActive =
      isOnHome && currentSessionKey === s.key && currentSessionKey !== DEFAULT_SESSION_KEY;
    const isPinned = catalogByKey[s.key]?.pinRank != null;
    const channelSource = resolveSidebarChannelSource(s.key, catalogByKey[s.key]?.channelType);
    return (
      <SidebarRecentSessionRow
        key={s.key}
        session={s}
        label={sessionLabel}
        isActive={isRecentSessionActive}
        isPinned={isPinned}
        channelSource={channelSource}
        isEditing={editingSessionKey === s.key}
        editingValue={editingValue}
        onOpen={() => {
          navigateToMainChatHome(navigate, location.pathname, () => switchSession(s.key));
        }}
        onPin={() => {
          void (async () => {
            const currentPin = catalogByKey[s.key]?.pinRank ?? null;
            if (currentPin != null) {
              await patchSessionCatalog({ sessionKey: s.key, pinRank: null });
              toast.success(t('common:sidebar.unpinnedInRecent'));
              return;
            }
            await patchSessionCatalog({ sessionKey: s.key, pinRank: 1 });
            toast.success(t('common:sidebar.pinnedInRecent'));
          })();
        }}
        onStartRename={() => {
          setEditingSessionKey(s.key);
          setEditingValue(sessionLabel);
        }}
        onEditingValueChange={setEditingValue}
        onCommitRename={() => {
          renameSession(s.key, editingValue);
          setEditingSessionKey(null);
        }}
        onCancelRename={() => setEditingSessionKey(null)}
        onDelete={() => {
          requestSessionDelete({ key: s.key, label: sessionLabel });
        }}
      />
    );
  }, [
    catalogByKey,
    currentSessionKey,
    editingSessionKey,
    editingValue,
    getSessionLabel,
    isOnHome,
    location.pathname,
    navigate,
    patchSessionCatalog,
    renameSession,
    requestSessionDelete,
    switchSession,
    t,
  ]);

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

  const workspaceScopedSessions = useMemo(
    () => normalSessions.filter((session) => isSessionInActiveWorkspace(
      session.key,
      null,
      sessionWorkspaceByKey,
    )),
    [normalSessions, sessionWorkspaceByKey],
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
    () => sortSessionsWithCatalogPin(workspaceScopedSessions, sessionLastActivity, catalogByKey),
    [workspaceScopedSessions, sessionLastActivity, catalogByKey],
  );

  // Legacy 日期分桶：折叠轨与潜在回滚仍可能读取 bucket 数据
  for (const session of recentSessionsSorted) {
    const bucketKey = getSessionBucket(getEffectiveActivityMs(session), nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const sessionsOrderedForCollapse = recentSessionsSorted.slice(0, SIDEBAR_COLLAPSED_SESSION_LIMIT);

  // Group scheduled-task sessions by task id; titles resolved from task definitions + session metadata.
  const scheduledTaskGroups = useMemo(() => {
    type GroupDraft = {
      key: string;
      kind: 'st' | 'cron' | 'claude';
      taskId: number | string;
      sessions: typeof visibleSessions;
    };
    const groups = new Map<string, GroupDraft>();

    for (const session of taskListScheduledSessions) {
      const stParsed = parseScheduledTaskAgentSessionKey(session.key);
      const cronParsed = parseCronSessionKey(session.key);
      const claudeTaskRunParsed = parseClaudeScheduledTaskRunSessionKey(session.key);
      const claudeTaskDatedParsed = parseClaudeScheduledTaskSessionKey(session.key);

      let draft: GroupDraft | undefined;
      if (stParsed) {
        draft = { key: `st:${stParsed.taskId}`, kind: 'st', taskId: stParsed.taskId, sessions: [] };
      } else if (cronParsed) {
        draft = { key: `cron:${cronParsed.jobId}`, kind: 'cron', taskId: cronParsed.jobId, sessions: [] };
      } else if (claudeTaskDatedParsed) {
        draft = {
          key: `claude-task:${claudeTaskDatedParsed.taskId}`,
          kind: 'claude',
          taskId: claudeTaskDatedParsed.taskId,
          sessions: [],
        };
      } else if (claudeTaskRunParsed) {
        draft = {
          key: `claude-task:${claudeTaskRunParsed.taskId}`,
          kind: 'claude',
          taskId: claudeTaskRunParsed.taskId,
          sessions: [],
        };
      }

      if (!draft) continue;
      const existing = groups.get(draft.key);
      if (existing) {
        existing.sessions.push(session);
      } else {
        groups.set(draft.key, { ...draft, sessions: [session] });
      }
    }

    const resolvedGroups: ScheduledTaskSidebarGroup[] = [];
    const sessionSortOptions = {
      runtimeBySessionKey,
      currentSessionKey,
      currentSessionSending: sending,
      activatingScheduledSessionAt,
      nowMs,
    };
    for (const group of groups.values()) {
      group.sessions.sort((a, b) => {
        const aAct = getSessionActivityMs(a, sessionLastActivity, sessionSortOptions);
        const bAct = getSessionActivityMs(b, sessionLastActivity, sessionSortOptions);
        return bAct - aAct;
      });
      resolvedGroups.push({
        key: group.key,
        name: buildScheduledTaskGroupDisplayName(group.kind, group.taskId, group.sessions, scheduledTaskNameMaps),
        sessions: group.sessions,
      });
    }

    return resolvedGroups;
  }, [taskListScheduledSessions, sessionLastActivity, scheduledTaskNameMaps, runtimeBySessionKey, currentSessionKey, sending, activatingScheduledSessionAt, nowMs]);

  const taskListRenderPlan = useMemo(() => {
    type SortableTaskListEntry = {
      key: string;
      name: string;
      sessions: Array<{ key: string; updatedAt?: number }>;
      renderItem: TaskListRenderItem;
    };

    const sortable: SortableTaskListEntry[] = [];

    for (const navItem of STO_TASK_NAV) {
      const entryIds = stoEntriesByTask[navItem.id] ?? [];
      if (entryIds.length === 0) continue;
      sortable.push({
        key: stoTaskSidebarGroupKey(navItem.id),
        name: t(`common:sidebar.${navItem.labelKey}`),
        sessions: buildBuiltinStoGroupSortSessions(navItem.id, entryIds, stoSessionKeyBySubitem),
        renderItem: { kind: 'sto', navItem },
      });
    }

    for (const group of scheduledTaskGroups) {
      if (group.sessions.length === 0) continue;
      sortable.push({
        key: group.key,
        name: group.name,
        sessions: group.sessions,
        renderItem: { kind: 'scheduled', group },
      });
    }

    const sorted = sortScheduledTaskGroupsByFirstTriggerDesc(
      sortable,
      sessionLastActivity,
      taskGroupFirstTriggeredAt,
    );
    return buildTaskListRenderPlan(sorted.map((entry) => entry.renderItem), taskListShowAll);
  }, [
    scheduledTaskGroups,
    stoEntriesByTask,
    stoSessionKeyBySubitem,
    sessionLastActivity,
    taskListShowAll,
    taskGroupFirstTriggeredAt,
    t,
  ]);

  const applyTaskGroupFirstTriggeredReactClear = useCallback((groupKey: string) => {
    setTaskGroupFirstTriggeredAt((prev) => {
      if (!(groupKey in prev)) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
  }, []);

  const applyTaskGroupFirstTriggeredReactRestore = useCallback((
    prep: LastSessionDeleteFirstTriggerPrep,
  ) => {
    if (prep.restoreAtMs == null || !(prep.restoreAtMs > 0)) return;
    setTaskGroupFirstTriggeredAt((prev) => ({ ...prev, [prep.groupKey]: prep.restoreAtMs! }));
  }, []);

  const clearFirstTriggerBeforeLastSessionDelete = useCallback(async (
    groupKey: string,
    fallbackAtMs: number,
  ): Promise<LastSessionDeleteFirstTriggerPrep | null> => {
    const prep = await prepareFirstTriggerClearBeforeLastSessionDelete(groupKey, {
      fallbackAtMs,
      notifyOnFailure: false,
    });
    if (!prep) return null;
    applyTaskGroupFirstTriggeredReactClear(groupKey);
    return prep;
  }, [applyTaskGroupFirstTriggeredReactClear]);

  const revertFirstTriggerClearAfterFailedSessionDelete = useCallback(async (
    prep: LastSessionDeleteFirstTriggerPrep,
  ) => {
    await revertFirstTriggerClearAfterFailedDelete(prep);
    applyTaskGroupFirstTriggeredReactRestore(prep);
  }, [applyTaskGroupFirstTriggeredReactRestore]);

  const countScheduledSessionsInGroup = useCallback((groupKey: string, excludingKey?: string) => {
    let count = 0;
    for (const session of taskListScheduledSessions) {
      if (excludingKey && session.key === excludingKey) continue;
      if (resolveTaskGroupKeyFromSessionKey(session.key) === groupKey) count += 1;
    }
    return count;
  }, [taskListScheduledSessions]);

  const collectScheduledSessionsForGroup = useCallback((groupKey: string) => (
    taskListScheduledSessions.filter((session) => resolveTaskGroupKeyFromSessionKey(session.key) === groupKey)
  ), [taskListScheduledSessions]);

  const applySeededFirstTriggered = useCallback((groupKey: string, triggeredAtMs: number) => {
    rememberOptimisticTaskGroupFirstTriggered(groupKey, triggeredAtMs);
    setTaskGroupFirstTriggeredAt((prev) => ({ ...prev, [groupKey]: triggeredAtMs }));
  }, []);

  const ensureTaskGroupFirstTriggerBeforePartialDelete = useCallback(async (
    groupKey: string | null,
    sessions: Array<{ key: string; updatedAt?: number }>,
  ) => {
    if (!groupKey || sessions.length === 0) return;
    if ((taskGroupFirstTriggeredAt[groupKey] ?? 0) > 0) return;
    const derived = deriveGroupFirstTriggeredFromSessions(sessions, sessionLastActivity);
    if (derived <= 0) return;
    const seeded = await seedTaskGroupFirstTriggeredIfAbsent(groupKey, derived);
    if (seeded) applySeededFirstTriggered(groupKey, derived);
  }, [taskGroupFirstTriggeredAt, sessionLastActivity, applySeededFirstTriggered]);

  const executeScheduledSessionDelete = useCallback(async ({ key }: { key: string }): Promise<boolean> => {
    const wasCurrentSession = useChatStore.getState().currentSessionKey === key;
    const groupKey = resolveTaskGroupKeyFromSessionKey(key);
    const remaining = groupKey != null ? countScheduledSessionsInGroup(groupKey, key) : 0;
    let firstTriggerPrep: LastSessionDeleteFirstTriggerPrep | null = null;
    let additionalSuppressKeys: string[] = [];
    const groupSessions = groupKey ? collectScheduledSessionsForGroup(groupKey) : [];
    const fallbackAtMs = groupKey
      ? deriveGroupFirstTriggeredFromSessions(groupSessions, sessionLastActivity)
      : 0;
    if (groupKey && remaining > 0) {
      await ensureTaskGroupFirstTriggerBeforePartialDelete(groupKey, groupSessions);
    } else if (groupKey && remaining === 0) {
      // 清 first-trigger 占位是尽力而为：即使失败也继续删除。
      // deleteSession 写入的删除墓碑（deletedSessions）才是刷新/重启/重装后
      // 过滤已删记录的权威依据，绝不能因清占位失败而跳过。
      firstTriggerPrep = await clearFirstTriggerBeforeLastSessionDelete(groupKey, fallbackAtMs);
      additionalSuppressKeys = rememberSuppressedKeysForLastGroupSessionDelete(
        groupKey,
        groupSessions,
        key,
        firstTriggerPrep?.restoreAtMs ?? fallbackAtMs,
      );
    }
    const deleted = await deleteSession(key, {
      skipSessionRefresh: groupKey != null && remaining === 0,
      additionalSuppressKeys,
    });
    if (!deleted) {
      if (firstTriggerPrep) {
        await revertFirstTriggerClearAfterFailedSessionDelete(firstTriggerPrep);
      }
      return false;
    }
    if (wasCurrentSession) {
      navigateToMainChatHome(navigate, location.pathname);
    }
    return true;
  }, [
    sessionLastActivity,
    countScheduledSessionsInGroup,
    collectScheduledSessionsForGroup,
    ensureTaskGroupFirstTriggerBeforePartialDelete,
    clearFirstTriggerBeforeLastSessionDelete,
    deleteSession,
    revertFirstTriggerClearAfterFailedSessionDelete,
    navigate,
    location.pathname,
  ]);

  const executeStoSubitemDelete = useCallback(async (payload: SidebarSubitemDeletePayload): Promise<boolean> => {
    const { sessionKey, taskId, entryId } = payload;
    const wasCurrentSession = useChatStore.getState().currentSessionKey === sessionKey;
    const entryIds = stoEntriesByTask[taskId] ?? [];
    const remainingBefore = entryIds.filter((id) => id !== entryId).length;

    const groupKey = stoBuiltinTaskGroupKey(taskId);
    let firstTriggerPrep: LastSessionDeleteFirstTriggerPrep | null = null;
    let additionalSuppressKeys: string[] = [];
    const groupSessions = buildBuiltinStoGroupSortSessions(taskId, entryIds, stoSessionKeyBySubitem);
    const fallbackAtMs = deriveGroupFirstTriggeredFromSessions(groupSessions, sessionLastActivity);
    if (remainingBefore > 0) {
      await ensureTaskGroupFirstTriggerBeforePartialDelete(groupKey, groupSessions);
    } else {
      // 清 first-trigger 占位是尽力而为：即使失败也继续删除。
      // deleteSession 写入的删除墓碑（deletedSessions）才是刷新/重启/重装后
      // 过滤已删记录的权威依据，绝不能因清占位失败而跳过。
      firstTriggerPrep = await clearFirstTriggerBeforeLastSessionDelete(groupKey, fallbackAtMs);
      additionalSuppressKeys = rememberSuppressedKeysForLastGroupSessionDelete(
        groupKey,
        groupSessions,
        sessionKey,
        firstTriggerPrep?.restoreAtMs ?? fallbackAtMs,
      );
    }
    const deleted = await deleteSession(sessionKey, {
      skipSessionRefresh: remainingBefore === 0,
      additionalSuppressKeys,
    });
    if (!deleted) {
      if (firstTriggerPrep) {
        await revertFirstTriggerClearAfterFailedSessionDelete(firstTriggerPrep);
      }
      return false;
    }
    removeSubitem(taskId, entryId);
    if (wasCurrentSession) {
      navigateToMainChatHome(navigate, location.pathname);
    }
    return true;
  }, [
    stoEntriesByTask,
    stoSessionKeyBySubitem,
    sessionLastActivity,
    ensureTaskGroupFirstTriggerBeforePartialDelete,
    clearFirstTriggerBeforeLastSessionDelete,
    deleteSession,
    revertFirstTriggerClearAfterFailedSessionDelete,
    removeSubitem,
    navigate,
    location.pathname,
  ]);

  useLayoutEffect(() => {
    registerDeleteConfirmExecutors({
      deleteSession: executeScheduledSessionDelete,
      deleteSubitem: executeStoSubitemDelete,
    });
  }, [registerDeleteConfirmExecutors, executeScheduledSessionDelete, executeStoSubitemDelete]);

  useEffect(() => {
    if (sidebarCollapsed) return;
    let cancelled = false;
    const backfill = async () => {
      const seeds: Array<{ groupKey: string; atMs: number }> = [];
      for (const navItem of STO_TASK_NAV) {
        const entryIds = stoEntriesByTask[navItem.id] ?? [];
        if (entryIds.length === 0) continue;
        const groupKey = stoTaskSidebarGroupKey(navItem.id);
        if ((taskGroupFirstTriggeredAt[groupKey] ?? 0) > 0) continue;
        if (isTaskGroupFirstTriggerOptimisticallyCleared(groupKey)) continue;
        const sessions = buildBuiltinStoGroupSortSessions(navItem.id, entryIds, stoSessionKeyBySubitem);
        const atMs = deriveGroupFirstTriggeredFromSessions(sessions, sessionLastActivity);
        if (atMs > 0) seeds.push({ groupKey, atMs });
      }
      for (const group of scheduledTaskGroups) {
        if (group.sessions.length === 0) continue;
        if ((taskGroupFirstTriggeredAt[group.key] ?? 0) > 0) continue;
        if (isTaskGroupFirstTriggerOptimisticallyCleared(group.key)) continue;
        const atMs = deriveGroupFirstTriggeredFromSessions(group.sessions, sessionLastActivity);
        if (atMs > 0) seeds.push({ groupKey: group.key, atMs });
      }
      for (const seed of seeds) {
        if (cancelled) return;
        const seeded = await seedTaskGroupFirstTriggeredIfAbsent(seed.groupKey, seed.atMs);
        if (seeded && !cancelled) applySeededFirstTriggered(seed.groupKey, seed.atMs);
      }
    };
    void backfill();
    return () => {
      cancelled = true;
    };
  }, [
    sidebarCollapsed,
    scheduledTaskGroups,
    stoEntriesByTask,
    stoSessionKeyBySubitem,
    sessionLastActivity,
    taskGroupFirstTriggeredAt,
    applySeededFirstTriggered,
  ]);
  const showTaskListExpandAll =
    taskListSectionOpen
    && !taskListShowAll
    && taskListRenderPlan.totalRows > SIDEBAR_TASK_LIST_INITIAL_ROW_LIMIT;

  const handleTaskGroupToggle = useCallback((groupKey: string) => {
    setExpandedTaskGroupIds((prev) => toggleGroupExpanded(prev, groupKey));
  }, []);

  const handleTaskGroupExpand = useCallback((groupKey: string) => {
    setExpandedTaskGroupIds((prev) => appendGroupExpanded(prev, groupKey));
  }, []);

  const expandableTaskGroupIds = useMemo(() => {
    return taskListRenderPlan.items.map((item) =>
      item.kind === 'sto'
        ? stoTaskSidebarGroupKey(item.navItem.id)
        : scheduledTaskSidebarGroupKey(item.group.key),
    );
  }, [taskListRenderPlan.items]);

  // 全部已展开 → 下次收起全部；否则（含部分展开）→ 展开全部
  const taskGroupsAllExpanded = areAllExpandableGroupsExpanded(
    expandedTaskGroupIds,
    expandableTaskGroupIds,
  );

  const handleTaskBatchExpandOrCollapse = () => {
    if (taskGroupsAllExpanded) {
      setExpandedTaskGroupIds(collapseAllGroups(expandableTaskGroupIds));
      return;
    }
    setExpandedTaskGroupIds(expandAllGroups(expandableTaskGroupIds));
  };

  const sidebarTaskFocusTokenRef = useRef<string | null>(null);

  const focusTaskExecutionInSidebar = useCallback((sessionKey: string) => {
    const groupKey = resolveTaskGroupKeyFromSessionKey(sessionKey);
    if (!groupKey) return;
    const expandKey = resolveSidebarExpandKeyForTaskGroup(groupKey);

    setTaskListSectionOpen(true);

    const groupVisible = taskListRenderPlan.items.some((item) => {
      if (item.kind === 'sto') return stoTaskSidebarGroupKey(item.navItem.id) === expandKey;
      return scheduledTaskSidebarGroupKey(item.group.key) === expandKey;
    });
    if (!groupVisible) {
      setTaskListShowAll(true);
    }

    // 自动聚焦只追加目标组，不关闭其它已展开组
    setExpandedTaskGroupIds((prev) => appendGroupExpanded(prev, expandKey));
  }, [taskListRenderPlan.items]);

  useEffect(() => {
    if (sidebarCollapsed) return;

    let focusSessionKey: string | null = null;

    const activatingEntries = Object.entries(activatingScheduledSessionAt);
    if (activatingEntries.length > 0) {
      activatingEntries.sort((a, b) => b[1] - a[1]);
      focusSessionKey = activatingEntries[0][0];
    } else if (resolveTaskGroupKeyFromSessionKey(currentSessionKey)) {
      focusSessionKey = currentSessionKey;
    }

    if (!focusSessionKey) {
      sidebarTaskFocusTokenRef.current = null;
      return;
    }

    const focusToken = `${focusSessionKey}:${activatingScheduledSessionAt[focusSessionKey] ?? sessionLastActivity[focusSessionKey] ?? 0}`;
    if (sidebarTaskFocusTokenRef.current === focusToken) return;
    sidebarTaskFocusTokenRef.current = focusToken;

    focusTaskExecutionInSidebar(focusSessionKey);
  }, [
    sidebarCollapsed,
    currentSessionKey,
    activatingScheduledSessionAt,
    sessionLastActivity,
    focusTaskExecutionInSidebar,
  ]);

  useLayoutEffect(() => {
    if (sidebarCollapsed || !taskListSectionOpen) return;
    // 手动展开任务时由 reveal effect 滚回顶部，避免 scrollIntoView 把视口又拉下去触发 auto-collapse
    if (suppressNextTaskAutoCollapseRef.current) return;

    let focusSessionKey: string | null = null;
    const activatingEntries = Object.entries(activatingScheduledSessionAt);
    if (activatingEntries.length > 0) {
      activatingEntries.sort((a, b) => b[1] - a[1]);
      focusSessionKey = activatingEntries[0][0];
    } else if (resolveTaskGroupKeyFromSessionKey(currentSessionKey)) {
      focusSessionKey = currentSessionKey;
    }
    if (!focusSessionKey) return;

    const groupKey = resolveTaskGroupKeyFromSessionKey(focusSessionKey);
    if (!groupKey) return;

    const expandKey = resolveSidebarExpandKeyForTaskGroup(groupKey);
    if (expandedTaskGroupIds[expandKey] !== true) return;

    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const container = scrollContainerRef.current;
      const el = container?.querySelector(
        `[data-sidebar-task-session="${CSS.escape(focusSessionKey)}"]`,
      );
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [
    sidebarCollapsed,
    taskListSectionOpen,
    currentSessionKey,
    activatingScheduledSessionAt,
    expandedTaskGroupIds,
    scrollContainerRef,
    taskListRenderPlan.items,
  ]);

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
      // { to: '/scheduled-tasks', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: `${t('common:sidebar.cronTasks')}（云）` },
      { to: '/my-tasks', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.myTasks') },
      // { to: '/cron', icon: <Clock className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.cronTasks') },
      { to: '/skills', icon: <Wrench className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.skills') },
      { to: '/workflow', icon: <Workflow className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.workflow') },
      { to: '/more-apps', icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.moreApps') },
      { to: '/models', icon: <BarChart3 className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.myData') },
      // { to: '/data-center', icon: <Database className="h-4 w-4" strokeWidth={1.75} />, label: t('common:sidebar.dataCenter') },
    ];
    return all.filter((item) => isSidebarPrimaryNavItemVisible(item.to, {
      primaryMyData: sidebarVis.primaryMyData,
      siteDepartmentTypesLoaded: siteDepartmentTypes !== null,
      isSite,
      isProduction: getCurrentEnvConfig().isProduction,
    }));
  }, [isSite, sidebarVis.primaryMyData, siteDepartmentTypes, t]);

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
      onPointerDownCapture={handleSidebarPointerDownCapture}
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
          sidebarCollapsed ? 'px-0 pt-2' : 'px-2 pt-0',
        )}
      >
        {/* 固定区：新对话、定时任务、技能广场、工作区等 */}
        <div className="flex shrink-0 flex-col gap-0.5">
        <div className={cn('flex flex-col gap-0.5', sidebarCollapsed && 'mt-2')}>
{primaryNav.map((item) => {
  // 当有选中非默认会话，或处于项目新对话草稿时，顶部「新对话」不高亮
  const shouldDimHome = Boolean(
    (currentSessionKey && currentSessionKey !== DEFAULT_SESSION_KEY)
    || pendingProjectId,
  );
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
          streamingMessages,
          streamingToolResults,
          streamingTools,
          pendingFinal,
          lastUserMessageAt,
          optimisticUserMessage,
          pendingToolImages,
          error,
          runtimeBySessionKey,
        } = useChatStore.getState();
        if (messages.length > 0 || currKey !== DEFAULT_SESSION_KEY || loading) {
          const nextRuntimeBySessionKey = {
            ...runtimeBySessionKey,
            [currKey]: {
              sending,
              aborting: useChatStore.getState().runtimeBySessionKey[currKey]?.aborting ?? false,
              activeRunId,
              sendAcceptance: useChatStore.getState().sendAcceptance,
              streamingText,
              streamingMessage,
              streamingMessages,
              streamingToolResults,
              streamingTools,
              pendingFinal,
              lastUserMessageAt,
              optimisticUserMessage,
              pendingToolImages,
              error,
              updatedAt: Date.now(),
            },
            [DEFAULT_SESSION_KEY]: {
              sending: false,
              aborting: false,
              activeRunId: null,
              sendAcceptance: null,
              streamingText: '',
              streamingMessage: null,
              streamingMessages: [],
              streamingToolResults: [],
              streamingTools: [],
              pendingFinal: false,
              lastUserMessageAt: null,
              optimisticUserMessage: null,
              pendingToolImages: [],
              error: null,
              updatedAt: Date.now(),
            },
          };
          useChatStore.setState({
            currentSessionKey: DEFAULT_SESSION_KEY,
            currentAgentId: 'main',
            pendingProjectId: null,
            runtimeBySessionKey: nextRuntimeBySessionKey,
            messages: [],
            loading: false,
            sending: false,
            streamingText: '',
            streamingMessage: null,
            streamingMessages: [],
            streamingToolResults: [],
            streamingTools: [],
            activeRunId: null,
            sendAcceptance: null,
            error: null,
            pendingFinal: false,
            lastUserMessageAt: null,
            pendingToolImages: [],
            pendingWorkflow: null,
          });
        } else {
          useChatStore.getState().clearPendingWorkflowMemory();
          useChatStore.setState({
            pendingProjectId: null,
            currentAgentId: 'main',
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
      onClick={
        item.to === '/'
          ? () => handleHomeClick?.()
          : item.to === '/data-center'
            ? (e) => {
                e.preventDefault();
                navigate('/data-center');
              }
            : undefined
      }
      isActiveOverride={homeIsActiveOverride}
      badge={item.badge}
    />
  );
})}
        </div>

        {sidebarVis.workspace ? (
          !sidebarCollapsed ? (
            <SidebarCollapsibleSectionLabel
              className="mt-4"
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
        className={cn(sidebarScrollContainerClass, sidebarCollapsed ? 'px-0' : 'px-2')}
      >
        {!sidebarCollapsed ? (
          <SidebarProjectsSection
            collapsed={sidebarCollapsed}
            open={projectsSectionOpen}
            onToggle={toggleProjectsSection}
            shellRef={projectSectionHeaderRef}
            stickyTopClass={sidebarSectionStickyTopProjectClass}
          />
        ) : null}
        {!sidebarCollapsed ? (
          <SidebarCollapsibleSectionLabel
            shellRef={taskSectionHeaderRef}
            stickyTopClass={sidebarSectionStickyTopTaskClass}
            open={taskListSectionOpen}
            onToggle={toggleTaskListSection}
            label={t('common:sidebar.taskList')}
            toggleAriaLabel={t('common:sidebar.toggleTaskListSection')}
            actions={
              taskListSectionOpen && expandableTaskGroupIds.length > 0 ? (
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={
                        taskGroupsAllExpanded
                          ? t('common:sidebar.collapseAllGroups')
                          : t('common:sidebar.expandAllGroups')
                      }
                      onClick={handleTaskBatchExpandOrCollapse}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--sto-sidebar-row-hover-bg)]',
                        sidebarTextIconClass,
                      )}
                    >
                      {/* MasterGo：已展开显示折叠 icon；有未展开项显示展开 icon */}
                      {taskGroupsAllExpanded ? (
                        <img
                          src={sidebarCollapseAllGroupsIcon}
                          alt=""
                          className="h-[18px] w-[18px]"
                          aria-hidden
                        />
                      ) : (
                        <img
                          src={sidebarExpandAllGroupsIcon}
                          alt=""
                          className="h-[18px] w-[18px]"
                          aria-hidden
                        />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-xs">
                    {taskGroupsAllExpanded
                      ? t('common:sidebar.collapseAllGroups')
                      : t('common:sidebar.expandAllGroups')}
                  </TooltipContent>
                </Tooltip>
              ) : null
            }
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
                  isOpen={expandedTaskGroupIds[stoTaskSidebarGroupKey(item.navItem.id)] === true}
                  onToggle={() => handleTaskGroupToggle(stoTaskSidebarGroupKey(item.navItem.id))}
                  onRequestExpand={() => handleTaskGroupExpand(stoTaskSidebarGroupKey(item.navItem.id))}
                  onRequestDeleteSubitem={requestSubitemDelete}
                  maxVisibleEntries={item.maxVisibleEntries}
                />
              ) : (
                <SidebarScheduledTaskGroup
                  key={item.group.key}
                  name={item.group.name}
                  sessions={item.group.sessions}
                  isOpen={expandedTaskGroupIds[scheduledTaskSidebarGroupKey(item.group.key)] === true}
                  onToggle={() => handleTaskGroupToggle(scheduledTaskSidebarGroupKey(item.group.key))}
                  onRequestDelete={requestSessionDelete}
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
            className="pointer-events-none -mb-1 h-0 w-full shrink-0 overflow-hidden opacity-0"
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
                              {bucket.sessions.slice(0, getBucketVisibleCount(bucket.key)).map((s) =>
                                renderRecentSessionRow(s),
                              )}
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
                {recentSessionsSorted.length > 0 ? (
                  recentSessionsSorted.slice(0, getRecentVisibleCount()).map((s) => renderRecentSessionRow(s))
                ) : null}
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
          <div
            className={cn(
              'flex items-center',
              sidebarVis.userProfileCard && sidebarCollapsed
                ? 'flex-col gap-1'
                : sidebarVis.userProfileCard
                  ? 'w-full'
                  : 'gap-1',
            )}
          >
          <DropdownMenu
            open={accountMenuOpen}
            onOpenChange={(open) => {
              setAccountMenuOpen(open);
              if (open) {
                setSupportQrOpen(false);
              }
            }}
          >
            {accountFooterMode === 'expanded-hotzone' ? (
              <div className="flex w-full min-w-0 items-center gap-3">
                {/* 展开态：整块账号信息为菜单热区，无齿轮；问号独立（MasterGo 39:35844） */}
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={sidebarAccountHotzoneTriggerClass}
                    aria-label={t('common:sidebar.compactAccountMenu')}
                    title={
                      isGatewayRunning
                        ? t('common:status.connected')
                        : t('common:status.disconnected')
                    }
                    onPointerEnter={() => setSupportQrOpen(false)}
                    onPointerDown={() => setSupportQrOpen(false)}
                  >
                    <span className={sidebarFooterNameClass}>
                      {authUser.realName?.trim() || authUser.userName}
                    </span>
                    {authUser.companyName?.trim() ? (
                      <span className={sidebarFooterMetaClass}>
                        {authUser.companyName.trim()}
                      </span>
                    ) : null}
                  </button>
                </DropdownMenuTrigger>
                <SidebarSupportQrTooltip
                  className={sidebarAccountHelpTriggerClass}
                  open={supportQrOpen}
                  onOpenChange={(open) => {
                    setSupportQrOpen(open);
                    if (open) {
                      setAccountMenuOpen(false);
                    }
                  }}
                />
              </div>
            ) : (
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 text-left transition-colors',
                    accountFooterMode === 'collapsed-avatar'
                      ? 'w-full flex-col items-center justify-center gap-0 p-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.04]'
                      : cn(
                          'w-full items-center justify-center',
                          SIDEBAR_ACCOUNT_SETTINGS_TRIGGER_CLASS,
                        ),
                  )}
                  onPointerEnter={() => setSupportQrOpen(false)}
                  onPointerDown={() => setSupportQrOpen(false)}
                  title={
                    accountFooterMode === 'collapsed-avatar'
                      ? isGatewayRunning
                        ? t('common:status.connected')
                        : t('common:status.disconnected')
                      : `${t('common:sidebar.compactAccountMenu')} — ${isGatewayRunning ? t('common:status.connected') : t('common:status.disconnected')}`
                  }
                  aria-label={
                    accountFooterMode === 'collapsed-avatar'
                      ? undefined
                      : t('common:sidebar.compactAccountMenu')
                  }
                >
                  {accountFooterMode === 'collapsed-avatar' ? (
                    <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--sto-sidebar-border)] bg-white text-[13px] font-semibold text-[var(--sto-brand-6)] dark:bg-card">
                      {authUser.realName?.[0] || authUser.userName?.[0] || '?'}
                    </span>
                  ) : shouldRenderAccountGearIcon(accountFooterMode) ? (
                    <SettingsIcon className={sidebarFooterSettingsIconClass} strokeWidth={1.75} aria-hidden />
                  ) : null}
                </button>
              </DropdownMenuTrigger>
            )}
            <DropdownMenuContent
              side="top"
              align="center"
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
                className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
              >
                {t('common:sidebar.settings')}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => navigate('/settings/updates')}
                className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
              >
                {t('common:sidebar.checkUpdates')}
              </DropdownMenuItem>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER, 'gap-2')}
                >
                  <span className="flex-1">{t('settings:appearance.language')}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#86909C]" strokeWidth={2} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4} className={SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS}>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER, 'gap-2')}
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
                <DropdownMenuSubTrigger
                  className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER, 'gap-2')}
                >
                  <span className="flex-1">{t('settings:appearance.theme')}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#86909C]" strokeWidth={2} />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent sideOffset={4} className={SIDEBAR_ACCOUNT_MENU_SUBCONTENT_CLASS}>
                  {(['light', 'dark', 'system'] as const).map((t_value) => (
                    <DropdownMenuItem
                      key={t_value}
                      onClick={() => setTheme(t_value)}
                      className={cn(SIDEBAR_ACCOUNT_MENU_ITEM_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER, 'gap-2')}
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

              <div className={SIDEBAR_ACCOUNT_MENU_DIVIDER_CLASS} aria-hidden="true" />

              <DropdownMenuItem
                onClick={() => setShowLogoutConfirm(true)}
                className={cn(SIDEBAR_ACCOUNT_MENU_LOGOUT_CLASS, SIDEBAR_ACCOUNT_MENU_ITEM_HOVER)}
              >
                {t('auth:logout.button')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {accountFooterMode !== 'expanded-hotzone' ? (
            <SidebarSupportQrTooltip
              open={supportQrOpen}
              onOpenChange={(open) => {
                setSupportQrOpen(open);
                if (open) {
                  setAccountMenuOpen(false);
                }
              }}
            />
          ) : null}
          </div>
        </div>
      ) : null}
        </>
      ) : null}

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
