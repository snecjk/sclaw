import { ChevronDown, Loader2, X, ZoomIn } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArtifactProductCard } from '@/components/chat/artifact-product-card';
import { ChatToolCallCard } from '@/components/chat/chat-tool-call-card';
import { Button } from '@/components/ui/button';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';
import {
  stoChatScrollContentClass,
  stoChatScrollPaneClass,
  stoOverlayScrollHostClass,
  workflowParamsSummaryCardClass,
  workflowParamsSummaryGroupContentClass,
} from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import { sanitizeImRichHtml } from '@/lib/openim/im-rich-html';
import { formatImMessageTime } from './format-im-message-time';
import { ImAvatar } from './im-avatar';
import { ImMessageReadStatus, shouldShowMessageReadStatus } from './im-message-read-status';
import { ImMessageSenderMeta } from './im-message-sender-meta';
import { messagesConversationInsetClass } from './messages-conversation-inset';
import type { IMConversation, IMMessage } from '../types';

/** IM 消息气泡最大宽度 */
const IM_MESSAGE_MAX_WIDTH_CLASS = 'max-w-[60%]';
/** 钉钉 IM 正文：16px / 字间距 1px，单行气泡 36px */
const IM_MESSAGE_FONT_CLASS = "font-['PingFang_SC','Microsoft_YaHei',system-ui,sans-serif]";
const IM_MESSAGE_TEXT_CLASS =
  'text-[14px] font-normal leading-[22px] tracking-[1px] text-[#1F2329] antialiased dark:text-foreground';
const IM_MESSAGE_BUBBLE_PAD_CLASS = 'box-border min-h-9 px-3 py-[6px]';
const IM_MESSAGE_ROW_CLASS = 'group/message relative flex w-full items-start gap-2';
/** 对方：白底 + 细边框，左上直角，其余 12px 圆角 */
const IM_OTHER_BUBBLE_CLASS = cn(
  'bg-white dark:bg-[var(--sto-surface-elevated)]',
  'border border-[#E5E6EB] dark:border-[var(--sto-border-default)]',
  '!rounded-tl-none rounded-tr-[12px] rounded-br-[12px] rounded-bl-[12px]',
  IM_MESSAGE_BUBBLE_PAD_CLASS,
);
/** 自己：灰底，右上直角，其余 12px 圆角 */
const IM_SELF_BUBBLE_CLASS = cn(
  'bg-[#E4E4E4] dark:bg-muted',
  '!rounded-tr-none rounded-tl-[12px] rounded-bl-[12px] rounded-br-[12px]',
  IM_MESSAGE_BUBBLE_PAD_CLASS,
);

function ImMessageTime({ time, align = 'start' }: { time: string; align?: 'start' | 'end' }) {
  return (
    <div
      className={cn(
        // w-max + nowrap: full datetime must not wrap inside a short bubble (would overlap content).
        'pointer-events-none absolute -top-4 w-max whitespace-nowrap text-[11px] leading-4 text-[var(--sto-text-tertiary)]',
        'opacity-0 transition-opacity duration-150 group-hover/message:opacity-100',
        align === 'end' ? 'right-0 text-right' : 'left-0 text-left',
      )}
    >
      {formatImMessageTime(time)}
    </div>
  );
}

function resolveMessageAvatar(
  message: IMMessage,
  conversation: IMConversation,
  selfLabel: string,
): { kind: 'single' | 'group' | 'digital_employee'; label: string } {
  if (message.role === 'self') {
    return { kind: 'single', label: selfLabel };
  }
  if (conversation.type === 'digital_employee') {
    return { kind: 'digital_employee', label: message.senderAvatarLabel ?? '🤖' };
  }
  const label = message.senderAvatarLabel
    ?? (message.senderName ? message.senderName.slice(0, 1) : conversation.avatarLabel);
  return { kind: 'single', label };
}

function ImArtifactCard({ artifact }: { artifact: NonNullable<IMMessage['artifact']> }) {
  const { t } = useTranslation('common');
  const metaLine = `${artifact.fileName} · ${artifact.fileSize}`;

  return (
    <ArtifactProductCard
      title={artifact.title}
      metaLine={metaLine}
      actionLabel={t('im.preview')}
      onAction={() => undefined}
      showActionLabel
    />
  );
}

function ImThinkingBubble({ message }: { message: IMMessage }) {
  const [open, setOpen] = useState(!message.collapsed);
  const { t } = useTranslation('common');

  return (
    <div className={workflowParamsSummaryCardClass}>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        <span className="text-[13px] leading-5 text-foreground">{t('im.thinking')}</span>
        <ChevronDown
          className={cn('ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className={cn(workflowParamsSummaryGroupContentClass, 'mt-2')}>{message.content}</div>
      ) : null}
    </div>
  );
}

function ImFileBubble({ fileName, content }: { fileName?: string; content: string }) {
  return (
    <div className={cn(IM_OTHER_BUBBLE_CLASS, 'flex items-center gap-2')}>
      <span className="text-lg" aria-hidden>📎</span>
      <span className={cn(IM_MESSAGE_FONT_CLASS, IM_MESSAGE_TEXT_CLASS, 'break-all')}>
        {fileName ?? content}
      </span>
    </div>
  );
}

function ImImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt || '图片预览'}
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] max-w-[92vw] flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          onClick={onClose}
          title="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>,
    document.body,
  );
}

function ImImageBubble({
  mediaUrl,
  previewUrl,
  alt,
}: {
  mediaUrl: string;
  previewUrl?: string;
  alt: string;
}) {
  const [open, setOpen] = useState(false);
  const fullSrc = previewUrl || mediaUrl;

  return (
    <>
      <button
        type="button"
        className={cn(
          'group/img relative block max-w-full overflow-hidden rounded-[12px]',
          'border border-[#E5E6EB] dark:border-[var(--sto-border-default)]',
          'cursor-zoom-in text-left',
        )}
        onClick={() => setOpen(true)}
        aria-label="预览图片"
      >
        <img
          src={mediaUrl}
          alt={alt}
          className="max-h-64 max-w-full object-contain"
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/img:bg-black/20">
          <ZoomIn className="h-6 w-6 text-white opacity-0 drop-shadow transition-opacity group-hover/img:opacity-100" />
        </div>
      </button>
      {open ? (
        <ImImageLightbox
          src={fullSrc}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ImRichBubble({
  html,
  isSelf,
}: {
  html: string;
  isSelf: boolean;
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const safeHtml = sanitizeImRichHtml(html, { allowLocalImg: true });

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName !== 'IMG') return;
    const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src;
    if (src) setPreviewSrc(src);
  };

  return (
    <>
      <div
        className={cn(
          'w-fit max-w-full overflow-hidden',
          isSelf ? IM_SELF_BUBBLE_CLASS : IM_OTHER_BUBBLE_CLASS,
          IM_MESSAGE_FONT_CLASS,
          IM_MESSAGE_TEXT_CLASS,
          'im-rich-bubble [&_a]:text-[#3491FA] [&_a]:underline',
          '[&_img]:my-1 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-lg',
          '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
          '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_p]:my-0',
        )}
        // Sanitized HTML from im_rich_v1 payload.
        dangerouslySetInnerHTML={{ __html: safeHtml }}
        onClick={handleClick}
      />
      {previewSrc ? (
        <ImImageLightbox
          src={previewSrc}
          alt="图片预览"
          onClose={() => setPreviewSrc(null)}
        />
      ) : null}
    </>
  );
}

function ImMessageBubble({
  message,
  conversation,
  selfLabel,
}: {
  message: IMMessage;
  conversation: IMConversation;
  selfLabel: string;
}) {
  if (message.role === 'system') {
    return (
      <div className="py-1 text-center text-[11px] leading-5 text-muted-foreground">
        {message.content}
      </div>
    );
  }

  const isSelf = message.role === 'self';
  const avatar = resolveMessageAvatar(message, conversation, selfLabel);
  const timeAlign = isSelf ? 'end' : 'start';
  const showSenderMeta = conversation.type === 'group'
    || (conversation.type === 'single' && isSelf);

  const wrapBubbleWithTime = (content: ReactNode) => {
    if (!message.time || showSenderMeta) return content;
    return (
      <div className="relative w-fit max-w-full">
        <ImMessageTime time={message.time} align={timeAlign} />
        {content}
      </div>
    );
  };

  const bubbleBody = message.contentType === 'artifact' && message.artifact ? (
    wrapBubbleWithTime(<ImArtifactCard artifact={message.artifact} />)
  ) : message.contentType === 'thinking' ? (
    wrapBubbleWithTime(<ImThinkingBubble message={message} />)
  ) : message.contentType === 'tool' ? (
    wrapBubbleWithTime(
      <ChatToolCallCard
        name={message.toolName ?? 'tool'}
        input={message.content}
        status="completed"
      />,
    )
  ) : message.contentType === 'rich' && message.richHtml ? (
    wrapBubbleWithTime(<ImRichBubble html={message.richHtml} isSelf={isSelf} />)
  ) : message.contentType === 'image' && message.mediaUrl ? (
    wrapBubbleWithTime(
      <ImImageBubble
        mediaUrl={message.mediaUrl}
        previewUrl={message.previewUrl}
        alt={message.content}
      />,
    )
  ) : message.contentType === 'file' ? (
    wrapBubbleWithTime(<ImFileBubble fileName={message.fileName} content={message.content} />)
  ) : (
    wrapBubbleWithTime(
      <div
        className={cn(
          'w-fit max-w-full',
          isSelf ? IM_SELF_BUBBLE_CLASS : IM_OTHER_BUBBLE_CLASS,
        )}
      >
        <p className={cn(IM_MESSAGE_FONT_CLASS, 'whitespace-pre-wrap break-words break-all', IM_MESSAGE_TEXT_CLASS)}>
          {message.content}
        </p>
      </div>,
    )
  );

  const messageColumn = (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        IM_MESSAGE_MAX_WIDTH_CLASS,
        isSelf ? 'items-end' : 'items-start',
      )}
    >
      {showSenderMeta ? (
        <ImMessageSenderMeta
          message={message}
          conversation={conversation}
          selfLabel={selfLabel}
          align={isSelf ? 'end' : 'start'}
        />
      ) : null}
      {bubbleBody}
      {shouldShowMessageReadStatus(message) ? (
        <ImMessageReadStatus
          readStatus={message.readStatus}
          groupReadReceipt={message.groupReadReceipt}
          isGroup={conversation.type === 'group'}
          align="end"
        />
      ) : null}
    </div>
  );

  const rowClassName = cn(
    IM_MESSAGE_ROW_CLASS,
    isSelf && 'justify-end',
    message.time && 'pt-4',
  );

  if (isSelf) {
    return (
      <div className={rowClassName} data-chat-message-role="user">
        {messageColumn}
        <ImAvatar kind={avatar.kind} label={avatar.label} size="sm" />
      </div>
    );
  }

  return (
    <div className={rowClassName} data-chat-message-role="assistant">
      <ImAvatar kind={avatar.kind} label={avatar.label} size="sm" />
      {messageColumn}
    </div>
  );
}

export function MessagePanel({
  title,
  subtitle,
  messages,
  conversation,
  hasMoreHistory,
  loadingMoreHistory,
  onLoadMore,
}: {
  title: string;
  subtitle?: string;
  messages: IMMessage[];
  conversation: IMConversation;
  hasMoreHistory?: boolean;
  loadingMoreHistory?: boolean;
  onLoadMore?: () => void;
}) {
  const { t } = useTranslation('common');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevConversationIdRef = useRef(conversation.id);
  const prevLastMessageIdRef = useRef<string | null>(null);
  /** After opening a conversation, keep sticking to bottom until history paints. */
  const forceScrollToBottomRef = useRef(true);
  const selfLabel = t('im.you');

  useEffect(() => {
    if (prevConversationIdRef.current === conversation.id) return;
    prevConversationIdRef.current = conversation.id;
    prevLastMessageIdRef.current = null;
    forceScrollToBottomRef.current = true;
  }, [conversation.id]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const lastMessage = messages[messages.length - 1];
    const lastMessageId = lastMessage?.id ?? null;
    if (!lastMessageId) return;

    const scrollToBottom = () => {
      viewport.scrollTop = viewport.scrollHeight;
    };

    // Opening / switching conversation: always land on latest once messages exist.
    if (forceScrollToBottomRef.current) {
      scrollToBottom();

      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        scrollToBottom();
        raf2 = requestAnimationFrame(scrollToBottom);
      });

      const content = contentRef.current;
      const observer = content
        ? new ResizeObserver(() => {
          if (forceScrollToBottomRef.current) scrollToBottom();
        })
        : null;
      if (content && observer) observer.observe(content);

      // Release after layout/images have a moment to settle.
      const releaseTimer = window.setTimeout(() => {
        forceScrollToBottomRef.current = false;
        prevLastMessageIdRef.current = lastMessageId;
        observer?.disconnect();
      }, 400);

      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        window.clearTimeout(releaseTimer);
        observer?.disconnect();
      };
    }

    const lastMessageChanged = lastMessageId !== prevLastMessageIdRef.current;
    // Loading older history prepends; last id unchanged → keep scroll position.
    if (!lastMessageChanged) return;
    prevLastMessageIdRef.current = lastMessageId;

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom < 140;
    const selfSent = lastMessage?.role === 'self';

    if (nearBottom || selfSent) {
      requestAnimationFrame(scrollToBottom);
    }
  }, [conversation.id, messages]);

  return (
    <>
      <div className={stoOverlayScrollHostClass}>
        <div ref={scrollRef} className={stoChatScrollPaneClass}>
          <div
            ref={contentRef}
            className={cn(
              stoChatScrollContentClass,
              messagesConversationInsetClass,
            )}
          >
            {hasMoreHistory ? (
              <div className="flex justify-center pb-3">
                <button
                  type="button"
                  disabled={loadingMoreHistory}
                  onClick={() => onLoadMore?.()}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] text-[var(--sto-text-tertiary)]',
                    'transition-colors hover:bg-[var(--sto-surface-hover)] disabled:opacity-50',
                  )}
                >
                  {loadingMoreHistory ? t('im.loadingHistory') : t('im.loadMoreHistory')}
                </button>
              </div>
            ) : null}
            {messages.map((message) => (
              <ImMessageBubble
                key={message.id}
                message={message}
                conversation={conversation}
                selfLabel={selfLabel}
              />
            ))}
          </div>
        </div>
        <OverlayScrollbar viewportRef={scrollRef} contentRef={contentRef} />
      </div>
      {subtitle ? (
        <div
          className={cn(
            'shrink-0 border-t border-border/60 py-2 text-[12px] leading-5 text-muted-foreground',
            messagesConversationInsetClass,
          )}
        >
          {subtitle}
        </div>
      ) : null}
      <div className="sr-only">{title}</div>
    </>
  );
}
