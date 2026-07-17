/**
 * ContentHeaderContext — 全局内容区 52px 标题栏槽位。
 *
 * 各路由页通过 useContentHeader 注入 title / actions；MainLayout 内 ContentHeader 读取渲染。
 */
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isSidebarPrimaryNavRoute } from '@/lib/sidebar-primary-nav';

export interface ContentHeaderSlot {
  /** 左侧标题（字符串或节点） */
  title: ReactNode;
  /** 三栏预览打开时：产物 tab 行（与右侧 icon 同高对齐） */
  previewTabs?: ReactNode;
  /** 会话区操作（搜索/刷新/思考等）：三栏时随对话列头部右对齐，单栏时并入右上角 icon 组 */
  chatActions?: ReactNode;
  /** 右侧操作区（icon 组） */
  actions?: ReactNode;
  /** 三栏预览已展开：MainLayout body 去掉水平 px，由 split row 与 header 共用 inset */
  isSplitLayout?: boolean;
  /** 会话标题 chip 关闭；传入时在字符串标题上渲染 pill + × */
  onCloseSession?: () => void;
}

interface ContentHeaderContextValue {
  slot: ContentHeaderSlot | null;
  setSlot: (slot: ContentHeaderSlot | null) => void;
}

const ContentHeaderContext = createContext<ContentHeaderContextValue | null>(null);

function resolveDefaultTitle(pathname: string, t: (key: string) => string): string {
  if (pathname === '/') return t('common:sidebar.home');
  if (matchPath({ path: '/tasks/:taskId/:entryId', end: true }, pathname)) return t('common:sidebar.taskList');
  if (matchPath({ path: '/tasks/:taskId', end: true }, pathname)) return t('common:sidebar.taskList');
  if (pathname.startsWith('/workflow')) return t('common:sidebar.workflow');
  // if (pathname.startsWith('/scheduled-tasks') || pathname.startsWith('/cron')) return t('common:sidebar.cronTasks');
  if (pathname.startsWith('/my-tasks')) return t('common:sidebar.myTasks');
  if (pathname.startsWith('/skills')) return t('common:sidebar.skills');
  if (pathname.startsWith('/more-apps')) return t('common:sidebar.moreApps');
  if (pathname.startsWith('/models')) return t('common:sidebar.models');
  if (pathname.startsWith('/data-center')) return t('common:sidebar.dataCenter');
  if (pathname.startsWith('/agents')) return t('common:sidebar.agents');
  if (pathname.startsWith('/channels')) return t('common:sidebar.channels');
  if (pathname.startsWith('/settings')) return t('common:sidebar.settings');
  if (pathname.startsWith('/subscriptions')) return t('common:sidebar.subscriptions');
  return t('common:sidebar.home');
}

export function ContentHeaderProvider({ children }: { children: ReactNode }) {
  const [slot, setSlotState] = useState<ContentHeaderSlot | null>(null);
  const setSlot = useCallback((next: ContentHeaderSlot | null) => {
    setSlotState((prev) => {
      if (prev === next) return prev;
      if (prev === null || next === null) return next;
      if (
        prev.title === next.title &&
        prev.previewTabs === next.previewTabs &&
        prev.chatActions === next.chatActions &&
        prev.actions === next.actions &&
        prev.isSplitLayout === next.isSplitLayout &&
        prev.onCloseSession === next.onCloseSession
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ slot, setSlot }), [slot, setSlot]);

  return (
    <ContentHeaderContext.Provider value={value}>
      {children}
    </ContentHeaderContext.Provider>
  );
}

function useContentHeaderRegistry() {
  const ctx = useContext(ContentHeaderContext);
  if (!ctx) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return ctx;
}

/** 当前页面向全局 ContentHeader 注入 title / previewTabs / actions；卸载时自动清空 */
export function useContentHeader({
  title,
  previewTabs,
  chatActions,
  actions,
  isSplitLayout = false,
  onCloseSession,
  enabled = true,
}: ContentHeaderSlot & { enabled?: boolean }) {
  const { setSlot } = useContentHeaderRegistry();

  useLayoutEffect(() => {
    if (!enabled) {
      setSlot(null);
      return;
    }
    setSlot({ title, previewTabs, chatActions, actions, isSplitLayout, onCloseSession });
    return () => setSlot(null);
  }, [title, previewTabs, chatActions, actions, isSplitLayout, onCloseSession, enabled, setSlot]);
}

/** ContentHeader 组件读取当前应展示的 title / previewTabs / actions（含路由默认标题） */
export function useContentHeaderDisplay(): {
  title: ReactNode | null;
  previewTabs: ReactNode | null;
  chatActions: ReactNode | null;
  actions: ReactNode | null;
  isSplitLayout: boolean;
  onCloseSession: (() => void) | null;
} {
  const { slot } = useContentHeaderRegistry();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const defaultTitle = resolveDefaultTitle(pathname, t);

  // primaryNav 路由：侧栏已标识功能，不展示兜底「首页 / 工作流」等；页面注入的会话 chip 仍走 slot.title
  const title = slot?.title ?? (isSidebarPrimaryNavRoute(pathname) ? null : defaultTitle);

  return {
    title,
    previewTabs: slot?.previewTabs ?? null,
    chatActions: slot?.chatActions ?? null,
    actions: slot?.actions ?? null,
    isSplitLayout: slot?.isSplitLayout ?? false,
    onCloseSession: slot?.onCloseSession ?? null,
  };
}
