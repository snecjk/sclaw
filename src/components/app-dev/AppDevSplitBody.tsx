/**
 * AppDevSplitBody — 建站工作台：左侧会话 + 右侧预览/代码，可左右拖拽改宽度。
 * 默认两侧都展开；收起工作区只隐藏右侧预览（保活），收起会话只保留预览。
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitPanelResizeHandle } from '@/components/layout/split-panel-resize-handle';
import { useAppDevSplitResize } from '@/hooks/use-app-dev-split-resize';
import {
  APP_DEV_CHAT_SPLIT_DEFAULT,
  APP_DEV_CHAT_SPLIT_MAX,
  APP_DEV_CHAT_SPLIT_MIN,
  APP_DEV_CHAT_SPLIT_STORAGE_KEY,
  appDevSplitRowClass,
  readStoredAppDevChatSplitPercent,
  writeStoredAppDevChatSplitPercent,
} from '@/lib/app-dev-split';
import { cn } from '@/lib/utils';

interface AppDevSplitBodyProps {
  chat: ReactNode;
  children: ReactNode;
  chatOpen?: boolean;
  /** 收起工作区：对话列全宽，工作台保活隐藏（0 宽，避免 webview 重载）。 */
  stageCollapsed?: boolean;
  defaultPercent?: number;
  storageKey?: string;
}

export function AppDevSplitBody({
  chat,
  children,
  chatOpen = true,
  stageCollapsed = false,
  defaultPercent = APP_DEV_CHAT_SPLIT_DEFAULT,
  storageKey = APP_DEV_CHAT_SPLIT_STORAGE_KEY,
}: AppDevSplitBodyProps) {
  const { t } = useTranslation('chat');
  const [chatSplitPercent, setChatSplitPercent] = useState(() => (
    readStoredAppDevChatSplitPercent(storageKey, defaultPercent)
  ));
  const persistPercent = useCallback((percent: number) => {
    setChatSplitPercent(percent);
    writeStoredAppDevChatSplitPercent(percent, storageKey, defaultPercent);
  }, [defaultPercent, storageKey]);
  const {
    splitRowRef,
    chatPanelRef,
    startResize,
    adjustChatPercent,
    isResizing,
  } = useAppDevSplitResize(chatSplitPercent, persistPercent, chatOpen);

  if (!chatOpen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        {children}
      </div>
    );
  }

  if (stageCollapsed) {
    // 工作台保留挂载（0 宽 + overflow hidden）：display:none 会触发
    // Electron <webview> 销毁重建，展开时预览会被强制刷新。
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]">
          {chat}
        </section>
        <div className="h-full w-0 shrink-0 overflow-hidden" aria-hidden>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={splitRowRef}
      data-resizing={isResizing ? 'true' : undefined}
      className={cn(appDevSplitRowClass, isResizing && 'select-none')}
    >
      <section
        ref={chatPanelRef}
        className="relative flex h-full min-h-0 min-w-0 flex-col"
      >
        {chat}
      </section>
      <div
        className={cn(
          'relative flex h-full min-h-0 min-w-0 flex-col border-l border-border',
          isResizing && 'pointer-events-none',
        )}
      >
        <SplitPanelResizeHandle
          valuePercent={chatSplitPercent}
          minPercent={APP_DEV_CHAT_SPLIT_MIN}
          maxPercent={APP_DEV_CHAT_SPLIT_MAX}
          isResizing={isResizing}
          onResizeStart={startResize}
          onKeyboardAdjust={(delta) => adjustChatPercent(-delta)}
          ariaLabel={t('preview.resizeChatSeparator')}
        />
        {children}
      </div>
    </div>
  );
}
