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
  /** 右侧操作区（icon 组）：预览面板展开/收起等 */
  actions?: ReactNode;
  /** 三栏预览已展开：MainLayout body 去掉水平 px，由 split row 与 header 共用 inset */
  isSplitLayout?: boolean;
  /** 会话标题 chip 关闭；传入时在字符串标题上渲染 pill + × */
  onCloseSession?: () => void;
}

const ContentHeaderSlotContext = createContext<ContentHeaderSlot | null | undefined>(undefined);
const ContentHeaderSetterContext = createContext<((slot: ContentHeaderSlot | null) => void) | null>(null);
const ContentHeaderSplitContext = createContext<boolean | undefined>(undefined);

function resolveDefaultTitle(pathname: string, t: (key: string) => string): string {
  if (pathname === '/') return t('common:sidebar.home');
  if (matchPath({ path: '/tasks/:taskId/:entryId', end: true }, pathname)) return t('common:sidebar.taskList');
  if (matchPath({ path: '/tasks/:taskId', end: true }, pathname)) return t('common:sidebar.taskList');
  if (pathname.startsWith('/workflow')) return t('common:sidebar.workflow');
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

  return (
    <ContentHeaderSetterContext.Provider value={setSlot}>
      <ContentHeaderSplitContext.Provider value={slot?.isSplitLayout ?? false}>
        <ContentHeaderSlotContext.Provider value={slot}>
          {children}
        </ContentHeaderSlotContext.Provider>
      </ContentHeaderSplitContext.Provider>
    </ContentHeaderSetterContext.Provider>
  );
}

function useContentHeaderRegistry() {
  const setSlot = useContext(ContentHeaderSetterContext);
  if (!setSlot) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return setSlot;
}

/** 当前页面向全局 ContentHeader 注入 title / previewTabs / chatActions / actions；卸载时自动清空 */
export function useContentHeader({
  title,
  previewTabs,
  chatActions,
  actions,
  isSplitLayout = false,
  onCloseSession,
  enabled = true,
}: ContentHeaderSlot & { enabled?: boolean }) {
  const setSlot = useContentHeaderRegistry();

  useLayoutEffect(() => {
    if (!enabled) {
      setSlot(null);
      return;
    }
    setSlot({ title, previewTabs, chatActions, actions, isSplitLayout, onCloseSession });
  }, [title, previewTabs, chatActions, actions, isSplitLayout, onCloseSession, enabled, setSlot]);

  // Dependency changes replace the slot in-place. Clearing in that effect's cleanup
  // causes an update loop when callers create fresh React nodes on every render:
  // cleanup -> setSlot(null) -> provider render -> fresh node -> cleanup. Only clear
  // when the page that owns the slot actually unmounts.
  useLayoutEffect(() => () => setSlot(null), [setSlot]);
}

/** ContentHeader 组件读取当前应展示的槽位（含路由默认标题） */
export function useContentHeaderDisplay(): {
  title: ReactNode | null;
  previewTabs: ReactNode | null;
  chatActions: ReactNode | null;
  actions: ReactNode | null;
  isSplitLayout: boolean;
  onCloseSession: (() => void) | null;
} {
  const slot = useContext(ContentHeaderSlotContext);
  if (slot === undefined) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
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

/** Layout ancestors subscribe only to the split flag, never to React-node slot contents. */
export function useContentHeaderSplitLayout(): boolean {
  const isSplitLayout = useContext(ContentHeaderSplitContext);
  if (isSplitLayout === undefined) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return isSplitLayout;
}
