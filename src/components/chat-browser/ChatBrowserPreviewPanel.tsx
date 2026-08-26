import { useMemo } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stoPreviewContentShellClass } from '@/lib/surfaces';
import {
  useChatBrowserPreviewStore,
  openChatBrowserPreview,
  type ChatBrowserPreviewTab,
} from '@/stores/chat-browser-preview';
import { openExternalUrl } from '@/lib/preview-url';

const EMPTY_BROWSER_TABS: ChatBrowserPreviewTab[] = [];

interface ChatBrowserPreviewPanelProps {
  sessionKey: string;
  className?: string;
}

export function ChatBrowserPreviewPanel({ sessionKey, className }: ChatBrowserPreviewPanelProps) {
  const tabs = useChatBrowserPreviewStore(
    (s) => s.tabsBySession[sessionKey] ?? EMPTY_BROWSER_TABS,
  );
  const activeTabId = useChatBrowserPreviewStore((s) => s.activeTabIdBySession[sessionKey] ?? null);
  const closeTab = useChatBrowserPreviewStore((s) => s.closeTab);
  const setActiveTab = useChatBrowserPreviewStore((s) => s.setActiveTab);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[tabs.length - 1] ?? null,
    [tabs, activeTabId],
  );

  if (!activeTab) {
    return (
      <div className={cn(stoPreviewContentShellClass, 'flex h-full items-center justify-center p-6 text-sm text-muted-foreground', className)}>
        暂无业务页面预览
      </div>
    );
  }

  return (
    <div className={cn(stoPreviewContentShellClass, 'flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'inline-flex max-w-[12rem] items-center gap-1 rounded-md px-2 py-1 text-[12px]',
                tab.id === activeTab.id
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60',
              )}
              onClick={() => setActiveTab(sessionKey, tab.id)}
            >
              <span className="truncate">{tab.title}</span>
              <span
                role="button"
                tabIndex={0}
                className="rounded p-0.5 hover:bg-background"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(sessionKey, tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeTab(sessionKey, tab.id);
                  }
                }}
                aria-label="关闭标签"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          title="刷新"
          onClick={() => {
            openChatBrowserPreview({
              sessionKey,
              url: activeTab.url,
              title: activeTab.title,
              force: true,
            });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          title="在浏览器打开"
          onClick={() => void openExternalUrl(activeTab.url)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <iframe
        key={`${activeTab.id}-${activeTab.remountKey ?? 0}`}
        id={`chat-browser-frame-${activeTab.id}`}
        title={activeTab.title}
        src={activeTab.url}
        className="h-full w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
