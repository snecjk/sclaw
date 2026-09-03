import { useVirtualizer } from '@tanstack/react-virtual';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  applyScrollAfterHistoryPrepend,
  createOlderHistoryScrollController,
  measureChatScroll,
  shouldFillViewportWithOlderHistory,
} from '@/components/chat/chat-static-items-scroll';
import type { RawMessage } from '@/stores/chat';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
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
  sessionKey?: string;
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
  /**
   * 显式放开用户消息「编辑重发」入口（P1 交互改造 T05）。
   * 缺省沿用旧判定：仅 `variant === 'page'`（主会话）透出编辑；
   * 传 `true` 后 home 等工作台变体同样把 onEditMessage 透传给消息组件。
   */
  enableEditMessage?: boolean;
  onOpenWorkflow?: (workflowId: string) => void;
  /**
   * 轮次 footer 注入点（P1 交互改造 T02）：渲染于 assistant-turn 消息之后，
   * 缺省不渲染，主会话零影响；T04 版本操作按钮也经此挂载。
   */
  renderTurnFooter?: (
    item: Extract<ChatDisplayItem, { type: 'assistant-turn' }>,
  ) => ReactNode;
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
    sessionKey,
    forceFullRender = false,
    matchedMessageKeys,
    activeSearchMessageKey = null,
    onReachStart,
    onPreviewFile,
    onCreateScheduledTask,
    onEditMessage,
    enableEditMessage,
    onOpenWorkflow,
    renderTurnFooter,
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
    const firstKey = items[0]?.key ?? '';
    const enableOlderHistory = typeof onReachStart === 'function';
    const historyFillToken = useChatRuntimeV2Store((state) => {
      if (!sessionKey) return '0:0';
      const session = state.sessionsByKey[sessionKey];
      if (!session) return '0:0';
      const hasOlder = session.historyTotalCount > session.transcript.length ? 1 : 0;
      return `${hasOlder}:${session.transcript.length}`;
    });
    const hasOlderHistory = historyFillToken.startsWith('1:');
    const prependAnchorRef = useRef({
      firstKey,
      count: items.length,
      scrollHeight: 0,
      clientHeight: 0,
    });

    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const previous = prependAnchorRef.current;
      const prepended = Boolean(
        firstKey
        && previous.firstKey
        && firstKey !== previous.firstKey
        && items.length > previous.count,
      );
      if (prepended) {
        applyScrollAfterHistoryPrepend(el, previous);
      }
      prependAnchorRef.current = {
        firstKey,
        count: items.length,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    }, [firstKey, items.length, scrollRef]);

    useEffect(() => {
      if (!enableOlderHistory) return;
      const el = scrollRef.current;
      if (!el) return;

      const controller = createOlderHistoryScrollController();
      const onScroll = () => {
        if (controller.onMetrics(measureChatScroll(el)) === 'load') {
          onReachStartRef.current?.();
        }
      };

      el.addEventListener('scroll', onScroll, { passive: true });
      const resizeObserver = new ResizeObserver(onScroll);
      resizeObserver.observe(el);
      onScroll();
      return () => {
        el.removeEventListener('scroll', onScroll);
        resizeObserver.disconnect();
        controller.reset();
      };
    }, [scrollRef, tailKey, enableOlderHistory]);

    useEffect(() => {
      if (!enableOlderHistory || !hasOlderHistory || items.length === 0) return;
      const el = scrollRef.current;
      if (!el) return;

      let requested = false;
      const tryFill = () => {
        if (requested) return;
        if (shouldFillViewportWithOlderHistory(measureChatScroll(el), true)) {
          requested = true;
          onReachStartRef.current?.();
        }
      };

      const frame = window.requestAnimationFrame(tryFill);
      const resizeObserver = new ResizeObserver(tryFill);
      resizeObserver.observe(el);
      return () => {
        window.cancelAnimationFrame(frame);
        resizeObserver.disconnect();
      };
    }, [scrollRef, items.length, hasOlderHistory, historyFillToken, enableOlderHistory]);

    const renderItem = (item: ChatDisplayItem) => {
      // T05：显式 enableEditMessage 覆盖 variant 判定；缺省仅主会话（page）可编辑
      const editMessageHandler = (enableEditMessage ?? variant === 'page') ? onEditMessage : undefined;
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
          <>
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
              onEditMessage={editMessageHandler}
            />
            {renderTurnFooter ? renderTurnFooter(item) : null}
          </>
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
          onEditMessage={editMessageHandler}
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
