/**
 * AppDevSplitBody — 建站工作台：左侧预览/代码 + 右侧会话，可左右拖拽改宽度。
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SplitPanelResizeHandle } from '@/components/layout/split-panel-resize-handle';
import { useAppDevSplitResize } from '@/hooks/use-app-dev-split-resize';
import {
  APP_DEV_CHAT_SPLIT_MAX,
  APP_DEV_CHAT_SPLIT_MIN,
  appDevSplitRowClass,
  readStoredAppDevChatSplitPercent,
  writeStoredAppDevChatSplitPercent,
} from '@/lib/app-dev-split';
import { cn } from '@/lib/utils';

interface AppDevSplitBodyProps {
  chat: ReactNode;
  children: ReactNode;
  chatOpen?: boolean;
}

export function AppDevSplitBody({
  chat,
  children,
  chatOpen = true,
}: AppDevSplitBodyProps) {
  const { t } = useTranslation('chat');
  const [chatSplitPercent, setChatSplitPercent] = useState(readStoredAppDevChatSplitPercent);
  const persistPercent = useCallback((percent: number) => {
    setChatSplitPercent(percent);
    writeStoredAppDevChatSplitPercent(percent);
  }, []);
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

  return (
    <div
      ref={splitRowRef}
      data-resizing={isResizing ? 'true' : undefined}
      className={cn(appDevSplitRowClass, isResizing && 'select-none')}
    >
      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col',
          isResizing && 'pointer-events-none',
        )}
      >
        {children}
      </div>
      <section
        ref={chatPanelRef}
        className="relative flex h-full min-h-0 min-w-0 flex-col border-l border-border"
      >
        <SplitPanelResizeHandle
          valuePercent={chatSplitPercent}
          minPercent={APP_DEV_CHAT_SPLIT_MIN}
          maxPercent={APP_DEV_CHAT_SPLIT_MAX}
          isResizing={isResizing}
          onResizeStart={startResize}
          onKeyboardAdjust={adjustChatPercent}
          ariaLabel={t('preview.resizeChatSeparator')}
        />
        {chat}
      </section>
    </div>
  );
}
