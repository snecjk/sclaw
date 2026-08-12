/**
 * ContentHeaderContext — 全局内容区 44px 标题栏槽位。
 *
 * 各路由页通过 useContentHeader 注入 title / chatActions / previewActions / layoutMode；
 * MainLayout 内 ContentHeader 读取渲染。
 *
 * Stage 3：最终槽位为 chatActions + previewActions + layoutMode。
 * `actions` / `isSplitLayout` 仅作单向兼容 adapter（写入时归一化）。
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

export type ContentHeaderLayoutMode = 'conversation' | 'split' | 'preview-expanded';

export interface ContentHeaderSlot {
  /** 左侧标题（字符串或节点） */
  title: ReactNode;
  /** 三栏 / expanded：产物 tab 行 */
  previewTabs?: ReactNode;
  /** 会话区操作（搜索/刷新/思考等） */
  chatActions?: ReactNode;
  /** 预览列操作（展开/收起/预览开关等）；conversation 时亦渲染在右上角 */
  previewActions?: ReactNode;
  /**
   * @deprecated Stage 3：请改用 previewActions；仍传入时单向映射到 previewActions
   */
  actions?: ReactNode;
  /** Workbench Header 模板 */
  layoutMode?: ContentHeaderLayoutMode;
  /**
   * @deprecated Stage 3：请改用 layoutMode；true 时映射为 `split`
   */
  isSplitLayout?: boolean;
  /** 会话标题 chip 关闭；传入时在字符串标题上渲染 pill + × */
  onCloseSession?: () => void;
}

interface NormalizedContentHeaderSlot {
  title: ReactNode;
  previewTabs?: ReactNode;
  chatActions?: ReactNode;
  previewActions?: ReactNode;
  layoutMode: ContentHeaderLayoutMode;
  onCloseSession?: () => void;
}

type SetContentHeaderSlot = (slot: NormalizedContentHeaderSlot | null) => void;

const ContentHeaderSlotContext = createContext<NormalizedContentHeaderSlot | null | undefined>(undefined);
const ContentHeaderRegistrationContext = createContext<SetContentHeaderSlot | null>(null);

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

function normalizeSlot(input: ContentHeaderSlot): NormalizedContentHeaderSlot {
  const layoutMode: ContentHeaderLayoutMode =
    input.layoutMode
    ?? (input.isSplitLayout ? 'split' : 'conversation');
  return {
    title: input.title,
    previewTabs: input.previewTabs,
    chatActions: input.chatActions,
    previewActions: input.previewActions ?? input.actions,
    layoutMode,
    onCloseSession: input.onCloseSession,
  };
}

export function ContentHeaderProvider({ children }: { children: ReactNode }) {
  const [slot, setSlotState] = useState<NormalizedContentHeaderSlot | null>(null);
  const setSlot = useCallback((next: NormalizedContentHeaderSlot | null) => {
    setSlotState((prev) => {
      if (prev === next) return prev;
      if (prev === null || next === null) return next;
      if (
        prev.title === next.title &&
        prev.previewTabs === next.previewTabs &&
        prev.chatActions === next.chatActions &&
        prev.previewActions === next.previewActions &&
        prev.layoutMode === next.layoutMode &&
        prev.onCloseSession === next.onCloseSession
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  return (
    <ContentHeaderRegistrationContext.Provider value={setSlot}>
      <ContentHeaderSlotContext.Provider value={slot}>
        {children}
      </ContentHeaderSlotContext.Provider>
    </ContentHeaderRegistrationContext.Provider>
  );
}

function useContentHeaderRegistration() {
  const setSlot = useContext(ContentHeaderRegistrationContext);
  if (!setSlot) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return setSlot;
}

function useRegisteredContentHeaderSlot() {
  const slot = useContext(ContentHeaderSlotContext);
  if (slot === undefined) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return slot;
}

/** 当前页面向全局 ContentHeader 注入槽位；卸载时自动清空 */
export function useContentHeader({
  title,
  previewTabs,
  chatActions,
  previewActions,
  actions,
  layoutMode,
  isSplitLayout = false,
  onCloseSession,
  enabled = true,
}: ContentHeaderSlot & { enabled?: boolean }) {
  const setSlot = useContentHeaderRegistration();

  useLayoutEffect(() => {
    if (!enabled) {
      setSlot(null);
      return;
    }
    setSlot(normalizeSlot({
      title,
      previewTabs,
      chatActions,
      previewActions,
      actions,
      layoutMode,
      isSplitLayout,
      onCloseSession,
    }));
    return () => setSlot(null);
  }, [
    title,
    previewTabs,
    chatActions,
    previewActions,
    actions,
    layoutMode,
    isSplitLayout,
    onCloseSession,
    enabled,
    setSlot,
  ]);
}

/** ContentHeader / MainLayout 读取当前应展示的槽位（含路由默认标题） */
export function useContentHeaderDisplay(): {
  title: ReactNode | null;
  previewTabs: ReactNode | null;
  chatActions: ReactNode | null;
  previewActions: ReactNode | null;
  layoutMode: ContentHeaderLayoutMode;
  /** @deprecated 派生自 layoutMode === 'split'；供过渡期 MainLayout / hooks 使用 */
  isSplitLayout: boolean;
  onCloseSession: (() => void) | null;
} {
  const slot = useRegisteredContentHeaderSlot();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const defaultTitle = resolveDefaultTitle(pathname, t);

  // primaryNav 路由：侧栏已标识功能，不展示兜底「首页 / 工作流」等；页面注入的会话 chip 仍走 slot.title
  const title = slot?.title ?? (isSidebarPrimaryNavRoute(pathname) ? null : defaultTitle);
  const layoutMode = slot?.layoutMode ?? 'conversation';

  return {
    title,
    previewTabs: slot?.previewTabs ?? null,
    chatActions: slot?.chatActions ?? null,
    previewActions: slot?.previewActions ?? null,
    layoutMode,
    isSplitLayout: layoutMode === 'split',
    onCloseSession: slot?.onCloseSession ?? null,
  };
}
