import { useVirtualizer } from '@tanstack/react-virtual';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type RefObject,
} from 'react';
import {
  measureChatScroll,
  shouldArmOlderHistoryLoader,
  shouldLoadOlderHistoryFromScroll,
} from '@/components/chat/chat-static-items-scroll';
import type { RawMessage } from '@/stores/chat';
import type { AttachedFileMeta } from '@/stores/chat';
import { WorkflowCard } from '@/components/workflow/WorkflowCard';
import { ChatMessage } from '@/pages/Chat/ChatMessage';
import { AssistantTurnMessage } from '@/pages/Chat/AssistantTurnMessage';
import {
  isAssistantRole,
  type ChatDisplayItem,
} from '@/pages/Chat/chat-display';
import {
  CHAT_VIRTUAL_LIST_THRESHOLD,
  CHAT_VIRTUAL_OVERSCAN,
  estimateChatDisplayItemSize,
} from '@/pages/Chat/chat-display-item-size';
import { resolveChatMessageSearchKey } from '@/pages/Chat/chat-message-search';

export type ChatStaticItemsListVariant = 'page' | 'home' | 'embed';

export interface ChatStaticItemsListHandle {
  scrollToSearchKey: (searchKey: string, behavior?: ScrollBehavior) => boolean;
}

export interface ChatStaticItemsListProps {
  items: ChatDisplayItem[];
  messages: RawMessage[];
  showThinking: boolean;
  scrollRef: RefObject<HTMLElement | null>;
  variant: ChatStaticItemsListVariant;
  /** 搜索打开时关闭虚拟化，保证 DOM 索引与滚动定位可用。 */
  forceFullRender?: boolean;
  onReachStart?: () => void;
  matchedMessageKeys?: Set<string>;
  activeSearchMessageKey?: string | null;
  onPreviewFile?: (file: AttachedFileMeta) => void;
  onCreateScheduledTask?: (workflowId: string) => void;
  onEditMessage?: (
    text: string,
    skillMeta?: RawMessage['_skillMeta'],
    options?: {
      segments?: RawMessage['_composerSegments'];
      attachments?: AttachedFileMeta[];
    },
  ) => void;
  onOpenWorkflow?: () => void;
}

function collectSearchKeysForDisplayItem(item: ChatDisplayItem): string[] {
  if (item.type === 'single') {
    return [resolveChatMessageSearchKey(item.message.id, `single:${item.key}`)];
  }
  if (item.type === 'assistant-turn') {
    const keys: string[] = [];
    item.messages.forEach((message, index) => {
      keys.push(resolveChatMessageSearchKey(
        message.id,
        `turn:${item.key}:preamble:${index}`,
      ));
    });
    const reply = item.messages[item.messages.length - 1];
    if (reply) {
      keys.push(resolveChatMessageSearchKey(reply.id, `turn:${item.key}:reply`));
    }
    return keys;
  }
  return [];
}

function findDisplayItemIndexForSearchKey(items: ChatDisplayItem[], searchKey: string): number {
  const target = searchKey.trim();
  if (!target) return -1;
  for (let index = 0; index < items.length; index += 1) {
    const keys = collectSearchKeysForDisplayItem(items[index]!);
    if (keys.includes(target)) return index;
  }
  return -1;
}

export const ChatStaticItemsList = forwardRef<ChatStaticItemsListHandle, ChatStaticItemsListProps>(
  function ChatStaticItemsList({
    items,
    messages,
    showThinking,
    scrollRef,
    variant,
    forceFullRender = false,
    matchedMessageKeys,
    activeSearchMessageKey = null,
    onReachStart,
    onPreviewFile,
    onCreateScheduledTask,
    onEditMessage,
    onOpenWorkflow,
  }, ref) {
    const virtualize = !forceFullRender && items.length > CHAT_VIRTUAL_LIST_THRESHOLD;

    const virtualizer = useVirtualizer({
      count: virtualize ? items.length : 0,
      getScrollElement: () => scrollRef.current,
      estimateSize: (index) => estimateChatDisplayItemSize(items[index]!),
      overscan: CHAT_VIRTUAL_OVERSCAN,
      getItemKey: (index) => items[index]?.key ?? String(index),
    });

    useImperativeHandle(ref, () => ({
      scrollToSearchKey: (searchKey, behavior = 'smooth') => {
        if (!virtualize) return false;
        const index = findDisplayItemIndexForSearchKey(items, searchKey);
        if (index < 0) return false;
        virtualizer.scrollToIndex(index, {
          align: 'start',
          behavior,
        });
        return true;
      },
    }), [items, virtualize, virtualizer]);

    const virtualItems = virtualizer.getVirtualItems();
    const onReachStartRef = useRef(onReachStart);
    onReachStartRef.current = onReachStart;
    const tailKey = items[items.length - 1]?.key ?? '';
    const enableOlderHistory = typeof onReachStart === 'function';

    useEffect(() => {
      if (!enableOlderHistory) return;
      const el = scrollRef.current;
      if (!el) return;

      let armed = false;
      const syncArm = () => {
        const metrics = measureChatScroll(el);
        if (!armed && shouldArmOlderHistoryLoader(metrics)) {
          armed = true;
        }
      };
      const onScroll = () => {
        syncArm();
        if (shouldLoadOlderHistoryFromScroll(armed, measureChatScroll(el))) {
          onReachStartRef.current?.();
        }
      };

      el.addEventListener('scroll', onScroll, { passive: true });
      const resizeObserver = new ResizeObserver(syncArm);
      resizeObserver.observe(el);
      syncArm();
      return () => {
        el.removeEventListener('scroll', onScroll);
        resizeObserver.disconnect();
      };
    }, [scrollRef, tailKey, enableOlderHistory]);

    const renderItem = (item: ChatDisplayItem) => {
      if (item.type === 'workflow-run') {
        if (variant === 'embed') return null;
        return (
          <WorkflowCard
            runId={item.card.runId}
            templateName={item.card.title}
            paramsSummary={item.card.paramsSummary}
            onPreviewArtifact={onPreviewFile}
            onCreateScheduledTask={onCreateScheduledTask}
            onOpenWorkflow={onOpenWorkflow}
          />
        );
      }

      if (item.type === 'assistant-turn') {
        return (
          <AssistantTurnMessage
            sessionMessages={messages}
            turnMessages={item.messages}
            turnToolResults={item.toolResults}
            precedingUserMessage={item.precedingUserMessage}
            turnStableKey={item.key}
            showThinking={showThinking}
            matchedMessageKeys={variant === 'embed' ? undefined : matchedMessageKeys}
            activeMessageKey={variant === 'embed' ? null : activeSearchMessageKey}
            onPreviewFile={onPreviewFile}
            onCreateScheduledTask={onCreateScheduledTask}
            onEditMessage={variant === 'page' ? onEditMessage : undefined}
          />
        );
      }

      const searchMessageKey = resolveChatMessageSearchKey(
        item.message.id,
        `single:${item.key}`,
      );

      return (
        <ChatMessage
          message={item.message}
          sessionMessages={messages}
          showThinking={showThinking}
          searchMessageKey={variant === 'embed' ? undefined : searchMessageKey}
          isSearchMatch={variant !== 'embed' && !!matchedMessageKeys?.has(searchMessageKey)}
          isSearchActive={variant !== 'embed' && searchMessageKey === activeSearchMessageKey}
          onPreviewFile={onPreviewFile}
          onCreateScheduledTask={onCreateScheduledTask}
          onEditMessage={variant === 'page' ? onEditMessage : undefined}
          isTurnDisplayReply={variant === 'page' && isAssistantRole(item.message.role)}
        />
      );
    };

    if (!virtualize) {
      return (
        <>
          {items.map((item) => (
            <div key={item.key}>
              {renderItem(item)}
            </div>
          ))}
        </>
      );
    }

    return (
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (!item) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    );
  },
);
