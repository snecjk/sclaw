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
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isSidebarPrimaryNavRoute } from '@/lib/sidebar-primary-nav';

export type ContentHeaderLayoutMode = 'conversation' | 'split' | 'preview-expanded' | 'preview-overlay';

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

const ContentHeaderSlotContext = createContext<NormalizedContentHeaderSlot | null | undefined>(undefined);
const ContentHeaderSetterContext = createContext<
  ((slot: NormalizedContentHeaderSlot | null) => void) | null
>(null);
const ContentHeaderLayoutModeContext = createContext<ContentHeaderLayoutMode | undefined>(undefined);

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
  if (pathname.startsWith('/learning-center')) return t('common:sidebar.learningCenter');
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
  const [slot, setSlot] = useState<NormalizedContentHeaderSlot | null>(null);

  return (
    <ContentHeaderSetterContext.Provider value={setSlot}>
      <ContentHeaderLayoutModeContext.Provider value={slot?.layoutMode ?? 'conversation'}>
        <ContentHeaderSlotContext.Provider value={slot}>
          {children}
        </ContentHeaderSlotContext.Provider>
      </ContentHeaderLayoutModeContext.Provider>
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
  const setSlot = useContentHeaderRegistry();

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

  // Updating a slot must not clear it first. Some callers create fresh React nodes on
  // every render; cleanup on every dependency change would cause a provider update loop.
  // Clear only when the page that owns the slot actually unmounts.
  useLayoutEffect(() => () => setSlot(null), [setSlot]);
}

/** ContentHeader / MainLayout 读取当前应展示的槽位（含路由默认标题） */
export function useContentHeaderDisplay(): {
  title: ReactNode | null;
  previewTabs: ReactNode | null;
  chatActions: ReactNode | null;
  previewActions: ReactNode | null;
  /** @deprecated Alias of previewActions for existing consumers. */
  actions: ReactNode | null;
  layoutMode: ContentHeaderLayoutMode;
  /** @deprecated 派生自 layoutMode === 'split'；供过渡期 MainLayout / hooks 使用 */
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

// primaryNav / 开发工作台：侧栏或页内自有标题，不展示兜底「首页 / 工作流」等；页面注入的会话 chip 仍走 slot.title
  const title = slot?.title ?? (isSidebarPrimaryNavRoute(pathname) ? null : defaultTitle);
  const layoutMode = slot?.layoutMode ?? 'conversation';

  return {
    title,
    previewTabs: slot?.previewTabs ?? null,
    chatActions: slot?.chatActions ?? null,
    previewActions: slot?.previewActions ?? null,
    actions: slot?.previewActions ?? null,
    layoutMode,
    isSplitLayout: layoutMode === 'split',
    onCloseSession: slot?.onCloseSession ?? null,
  };
}

/** Layout ancestors subscribe only to layout mode, never to React-node slot contents. */
export function useContentHeaderLayoutMode(): ContentHeaderLayoutMode {
  const layoutMode = useContext(ContentHeaderLayoutModeContext);
  if (layoutMode === undefined) {
    throw new Error('ContentHeaderContext is missing — wrap MainLayout with ContentHeaderProvider');
  }
  return layoutMode;
}

/** @deprecated Use {@link useContentHeaderLayoutMode}; kept for existing layout consumers. */
export function useContentHeaderSplitLayout(): boolean {
  return useContentHeaderLayoutMode() === 'split';
}
