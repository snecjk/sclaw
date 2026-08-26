/**
 * BrowserPreviewView — 业务网页预览（内置工作浏览器）
 *
 * 对齐 Kimi 右侧浏览器面板体验：
 * - chrome 工具栏：后退 / 前进 / 刷新 / 地址显示 / 外部打开
 * - 顶部加载进度条（iframe load 事件驱动）
 * - 多 tab keep-alive：非活跃 iframe 仅隐藏不卸载，页面状态（登录态/滚动/表单）保留
 * - 同源页面跟踪地址栏 URL（跨域时保持最后一次已知地址）
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { stoPreviewActionButtonClass } from '@/lib/surfaces';
import {
  useChatBrowserPreviewStore,
  type ChatBrowserPreviewTab,
} from '@/stores/chat-browser-preview';
import { openExternalUrl } from '@/lib/preview-url';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface BrowserPreviewViewProps {
  sessionKey: string;
  tabs: ChatBrowserPreviewTab[];
  activeTabId: string | null;
  className?: string;
}

function displayUrl(tab: ChatBrowserPreviewTab): string {
  return tab.currentUrl ?? tab.url;
}

export function BrowserPreviewView({
  sessionKey,
  tabs,
  activeTabId,
  className,
}: BrowserPreviewViewProps) {
  const { t } = useTranslation('chat');
  const updateTabUrl = useChatBrowserPreviewStore((s) => s.updateTabUrl);
  const iframeRefs = useRef(new Map<string, HTMLIFrameElement>());
  /** 每个 tab 的加载态（progress bar 只跟随活跃 tab） */
  const [loadingTabIds, setLoadingTabIds] = useState<ReadonlySet<string>>(() => new Set());

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[tabs.length - 1] ?? null;

  // 新挂载的 tab / force 刷新（remountKey 变化）→ 标记加载中（按 id+remountKey 去重，
  // 不能依赖 tabs 数组 identity——store 更新会产生新数组导致进度条卡住）
  const seenMountKeysRef = useRef(new Set<string>());
  useEffect(() => {
    const pending: string[] = [];
    for (const tab of tabs) {
      const mountKey = `${tab.id}:${tab.remountKey}`;
      if (!seenMountKeysRef.current.has(mountKey)) {
        seenMountKeysRef.current.add(mountKey);
        pending.push(tab.id);
      }
    }
    if (pending.length === 0) return;
    setLoadingTabIds((prev) => {
      const next = new Set(prev);
      for (const id of pending) next.add(id);
      return next;
    });
  }, [tabs]);

  if (!activeTab) {
    return (
      <div className={cn('flex h-full items-center justify-center p-6 text-sm text-muted-foreground', className)}>
        {t('preview.browser.empty')}
      </div>
    );
  }

  const markLoaded = (tabId: string) => {
    setLoadingTabIds((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    const iframe = iframeRefs.current.get(tabId);
    try {
      const href = iframe?.contentWindow?.location?.href;
      if (href && href !== 'about:blank') updateTabUrl(sessionKey, tabId, href);
    } catch {
      // 跨域页面：保持最后一次已知地址
    }
  };

  const withActiveFrame = (fn: (win: Window, iframe: HTMLIFrameElement) => void) => {
    const iframe = iframeRefs.current.get(activeTab.id);
    const win = iframe?.contentWindow;
    if (!iframe || !win) return;
    try {
      fn(win, iframe);
    } catch {
      // 跨域 history 调用被拦截时静默降级
    }
  };

  const handleBack = () => withActiveFrame((win) => win.history.back());
  const handleForward = () => withActiveFrame((win) => win.history.forward());

  const handleReload = () => {
    setLoadingTabIds((prev) => new Set(prev).add(activeTab.id));
    // location.reload() 是跨域白名单 API（HTML spec），可直接调用
    withActiveFrame((win) => win.location.reload());
  };

  const isLoading = loadingTabIds.has(activeTab.id);

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      {/* Chrome 工具栏 */}
      <div className="relative flex h-[38px] shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <ChromeButton
          label={t('preview.browser.back')}
          onClick={handleBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        </ChromeButton>
        <ChromeButton
          label={t('preview.browser.forward')}
          onClick={handleForward}
        >
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </ChromeButton>
        <ChromeButton
          label={t('preview.refresh')}
          onClick={handleReload}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} aria-hidden />
        </ChromeButton>

        {/* 地址栏（只读展示，同源导航会跟踪更新） */}
        <div
          className="mx-1 flex h-[26px] min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/60 px-3 dark:bg-muted/40"
          title={displayUrl(activeTab)}
        >
          <Globe className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-xs text-muted-foreground">
            {displayUrl(activeTab)}
          </span>
        </div>

        <ChromeButton
          label={t('preview.openExternal')}
          onClick={() => void openExternalUrl(displayUrl(activeTab))}
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </ChromeButton>

        {/* 顶部加载进度条 */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-300',
            isLoading ? 'opacity-100' : 'opacity-0',
          )}
        >
          <div className="browser-preview-progress h-full w-1/3 rounded-full bg-primary" />
        </div>
      </div>

      {/* 页面区：keep-alive 多 iframe */}
      <div className="relative min-h-0 flex-1 bg-white dark:bg-background">
        {tabs.map((tab) => (
          <iframe
            key={`${tab.id}-${tab.remountKey}`}
            ref={(el) => {
              if (el) iframeRefs.current.set(tab.id, el);
              else iframeRefs.current.delete(tab.id);
            }}
            id={`chat-browser-frame-${tab.id}`}
            title={tab.title}
            src={tab.url}
            onLoad={() => markLoaded(tab.id)}
            className={cn(
              'absolute inset-0 h-full w-full border-0 bg-white',
              tab.id === activeTab.id ? 'visible' : 'invisible pointer-events-none',
            )}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ))}
      </div>
    </div>
  );
}

function ChromeButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className={cn(stoPreviewActionButtonClass, 'h-[26px] w-[26px]')}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="border-none bg-[#1D2129] px-2.5 py-1.5 text-[12px] font-medium leading-4 text-white shadow-none dark:bg-[#1D2129] dark:text-white">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
