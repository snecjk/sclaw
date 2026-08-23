import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Info, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getHostApiBase } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { MentionSearchItem } from '@/types/dingtalk-mention';
import { OverlayScrollbar } from '@/components/ui/overlay-scrollbar';

type IndexedMentionSearchItem = MentionSearchItem & { sourceIndex: number };

function getAvatarInitial(item: MentionSearchItem): string {
  const title = item.title.trim();
  if (!title) return '?';
  const chineseChars = title.match(/[\u4e00-\u9fff]/g);
  if (item.type === 'user') {
    if (chineseChars?.length) return chineseChars.slice(-2).join('');
    return title.slice(0, 2).toUpperCase();
  }
  if (chineseChars?.length) {
    return chineseChars.slice(0, 2).join('');
  }
  return title.slice(0, 2).toUpperCase();
}

function resolveAvatarSrc(avatar?: string | null): string | null {
  if (!avatar?.trim()) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  if (avatar.startsWith('/api/dingtalk/avatar')) {
    return `${getHostApiBase()}${avatar}`;
  }
  return null;
}

function MentionAvatar({ item }: { item: MentionSearchItem }) {
  const [failed, setFailed] = useState(false);
  const avatarSrc = resolveAvatarSrc(item.avatar);
  const initial = getAvatarInitial(item);

  if (avatarSrc && !failed) {
    return (
      <img
        src={avatarSrc}
        alt={item.title}
        className="h-8 w-8 shrink-0 rounded-[8px] bg-[#DFEDFF] object-cover dark:bg-[#1677FF]/15"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#DFEDFF] text-[12px] font-semibold leading-none text-[#1677FF] dark:bg-[#1677FF]/15 dark:text-[#4C9BFF]" aria-hidden>
      {initial}
    </div>
  );
}

function MentionSection({
  title,
  items,
  emptyLabel,
  activeIndex,
  onHoverIndex,
  onSelect,
}: {
  title: string;
  items: IndexedMentionSearchItem[];
  emptyLabel?: string;
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: MentionSearchItem) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="px-2 py-1 text-[12px] font-medium leading-5 text-[#86909C] dark:text-muted-foreground">
        {title}
      </div>
      {items.length === 0 && emptyLabel ? (
        <div className="px-2 py-1 text-[12px] font-normal leading-5 text-[#C4CDD8] dark:text-muted-foreground/60">
          {emptyLabel}
        </div>
      ) : null}
      {items.map((item) => (
        <button
          key={`${item.type}:${item.id}`}
          type="button"
          data-mention-index={item.sourceIndex}
          className={cn(
            'flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left transition-colors',
            item.sourceIndex === activeIndex
              ? 'bg-[#F0F2F5] text-[#1F2937] dark:bg-white/10 dark:text-foreground'
              : 'hover:bg-[#F5F7FA] dark:hover:bg-white/[0.06]',
          )}
          onMouseEnter={() => onHoverIndex(item.sourceIndex)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item);
          }}
        >
          <MentionAvatar item={item} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-normal leading-5 text-[#111827] dark:text-foreground">{item.title}</div>
            {item.subtitle && (
              <div className="truncate text-[10px] font-normal leading-4 text-[#86909C] dark:text-muted-foreground">{item.subtitle}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

interface DingTalkMentionPopoverProps {
  open: boolean;
  items: MentionSearchItem[];
  query?: string;
  recent?: boolean;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  loggingIn?: boolean;
  installing?: boolean;
  error?: string | null;
  needsAuth?: boolean;
  needsInstall?: boolean;
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: MentionSearchItem) => void;
  onLogin?: () => void;
  onInstall?: () => void;
  onLoadMore?: () => void;
  /**
   * 锚定元素：有则 portal 到 document.body + fixed 定位，避免被 Modal / 输入壳
   * overflow 裁切（问题一）。无则退回 absolute 定位保持兼容（如 DingTalkRecipientField）。
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /** 点击浮层与 excludeRef 外部时关闭（如清除 @ 提及 trigger） */
  onDismissOutside?: () => void;
  /** 点击该区域内部时不触发 onDismissOutside（通常为编辑器 host） */
  dismissOutsideExcludeRef?: RefObject<HTMLElement | null>;
}

/** 向上空间不足时翻转向下的阈值（px） */
const MENTION_POPOVER_MIN_UPWARD_HEIGHT = 240;
/** 浮层宽度 */
const MENTION_POPOVER_WIDTH = 320;
/** 浮层最大高度上限（含标题/鉴权/列表） */
const MENTION_POPOVER_MAX_HEIGHT = 280;

type PopoverPosition = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

export function DingTalkMentionPopover({
  open,
  items,
  query = '',
  recent = false,
  loading = false,
  loadingMore = false,
  hasMore = false,
  loggingIn = false,
  installing = false,
  error,
  needsAuth = false,
  needsInstall = false,
  activeIndex,
  onHoverIndex,
  onSelect,
  onLogin,
  onInstall,
  onLoadMore,
  anchorRef,
  onDismissOutside,
  dismissOutsideExcludeRef,
}: DingTalkMentionPopoverProps) {
  const { t } = useTranslation('chat');
  const panelRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useEffect(() => {
    if (!open || !onDismissOutside) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (dismissOutsideExcludeRef?.current?.contains(target)) return;
      onDismissOutside();
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [dismissOutsideExcludeRef, onDismissOutside, open]);

  useEffect(() => {
    if (!open || items.length === 0) return;
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, items.length]);

  // portal 定位：锚定 anchorRef 的视口矩形，优先向上；向上空间不足时翻转向下。
  // 监听 scroll（capture）/ resize 更新坐标，跟随 Modal 滚动。
  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(MENTION_POPOVER_WIDTH, window.innerWidth - 24);
      const left = Math.min(
        Math.max(12, rect.left),
        window.innerWidth - width - 12,
      );
      const upwardSpace = rect.top;
      const downwardSpace = window.innerHeight - rect.bottom;
      // 上方不够完整展示时翻转向下；两侧都紧时选空间更大的一侧
      const flipDown = upwardSpace < MENTION_POPOVER_MIN_UPWARD_HEIGHT
        && downwardSpace >= upwardSpace;
      if (flipDown) {
        const maxHeight = Math.max(
          160,
          Math.min(downwardSpace - 16, MENTION_POPOVER_MAX_HEIGHT),
        );
        setPosition({ left, top: rect.bottom + 8, maxHeight });
      } else {
        const maxHeight = Math.max(
          160,
          Math.min(upwardSpace - 16, MENTION_POPOVER_MAX_HEIGHT),
        );
        setPosition({ left, bottom: window.innerHeight - rect.top + 8, maxHeight });
      }
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorRef]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    if (!recent || !hasMore || loading || loadingMore || !onLoadMore) return;
    const target = event.currentTarget;
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remaining > 48 || loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    void Promise.resolve(onLoadMore()).finally(() => {
      loadMoreLockRef.current = false;
    });
  }, [recent, hasMore, loading, loadingMore, onLoadMore]);

  if (!open) return null;

  const indexedItems = items.map((item, index) => ({ ...item, sourceIndex: index }));
  const contactItems = indexedItems.filter((item) => item.type === 'user');
  const groupItems = indexedItems.filter((item) => item.type === 'group');
  const hasVisibleItems = indexedItems.length > 0;
  const title = recent
    ? t('composer.dingtalkRecentTitle')
    : query.trim()
      ? t('composer.dingtalkSearchTitle')
      : t('composer.dingtalkMentionTitle');

  const useFixedPortal = Boolean(anchorRef);

  // 有 anchor 时等测量完成再渲染，避免首帧带 bottom-full 挂到 body 上闪一下
  if (useFixedPortal && !position) return null;

  const panel = (
    <div
      ref={panelRef}
      className={cn(
        'z-50 w-[320px] overflow-hidden rounded-[8px] border border-[#E5E6EB] bg-white p-2',
        'shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:border-border dark:bg-popover dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
        // 无 portal 时保持 absolute 上浮；有 fixed 时不可再带 bottom-full，否则会与 top 冲突压成一条缝
        useFixedPortal ? null : 'absolute left-0 bottom-full mb-2',
      )}
      style={
        useFixedPortal && position
          ? {
              position: 'fixed',
              left: position.left,
              top: position.top ?? 'auto',
              bottom: position.bottom ?? 'auto',
              maxHeight: position.maxHeight,
              overflowY: 'auto',
              zIndex: 60000,
            }
          : undefined
      }
    >
      <div className="px-2 py-1 text-[12px] font-medium leading-5 text-[#86909C] dark:text-muted-foreground">
        {title}
      </div>

      {needsInstall && (
        <div className="space-y-2 px-3 py-2">
          <div className="text-sm text-muted-foreground">
            {t('composer.dingtalkNeedsInstall')}
          </div>
          {onInstall && (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? t('composer.dingtalkInstalling') : t('composer.dingtalkInstall')}
            </button>
          )}
          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
        </div>
      )}

      {needsAuth && !needsInstall && (
        <div className="px-2 py-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-[6px] border border-[#FFD6BA] bg-[#FFF1E8] px-2 py-2 text-left transition-colors hover:bg-[#FFE9DA] disabled:cursor-not-allowed disabled:opacity-70 dark:border-primary/30 dark:bg-primary/10 dark:hover:bg-primary/[0.16]"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onLogin}
            disabled={!onLogin || loggingIn}
          >
            <Info className="h-4 w-4 shrink-0 text-[#FF6F00]" strokeWidth={2} aria-hidden />
            <span className="min-w-0 flex-1 text-[12px] font-normal leading-5 text-[#111827] dark:text-foreground">
              {t('composer.dingtalkNeedsAuth')}
            </span>
            <span className="inline-flex shrink-0 items-center text-[12px] font-medium leading-5 text-[#FF6F00]">
              {loggingIn ? t('composer.dingtalkLoggingIn') : t('composer.dingtalkLogin')}
              {!loggingIn && <ChevronRight className="ml-0.5 h-4 w-4" strokeWidth={2} aria-hidden />}
            </span>
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('composer.dingtalkSearching')}</span>
        </div>
      )}

      {!loading && !needsAuth && !needsInstall && error && (
        <div className="px-3 py-2 text-sm text-destructive">{error}</div>
      )}

      {!loading && !needsAuth && !needsInstall && !error && !hasVisibleItems && !query.trim() && (
        <div className="px-2 py-1 text-[12px] text-[#86909C] dark:text-muted-foreground">
          {t('composer.dingtalkNoResults')}
        </div>
      )}

      {!loading && !needsAuth && !needsInstall && !error && (hasVisibleItems || query.trim()) && (
        <div className="relative max-h-[280px] overflow-hidden">
          <div
            ref={listRef}
            className="sto-overlay-scroll-viewport max-h-[280px] overflow-y-auto overscroll-contain"
            onScroll={handleScroll}
          >
            <div ref={listContentRef}>
              <MentionSection
                title={t('composer.dingtalkContactsTitle')}
                items={contactItems}
                emptyLabel={query.trim() ? t('composer.dingtalkNoContacts') : undefined}
                activeIndex={activeIndex}
                onHoverIndex={onHoverIndex}
                onSelect={onSelect}
              />
              <MentionSection
                title={t('composer.dingtalkGroupsTitle')}
                items={groupItems}
                emptyLabel={query.trim() ? t('composer.dingtalkNoGroups') : undefined}
                activeIndex={activeIndex}
                onHoverIndex={onHoverIndex}
                onSelect={onSelect}
              />
              {recent && hasMore && !loadingMore && onLoadMore && (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12px] font-medium text-[#86909C] transition-colors hover:bg-[#F0F2F5] hover:text-[#111827] dark:text-muted-foreground dark:hover:bg-white/[0.06] dark:hover:text-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onLoadMore()}
                >
                  {t('composer.dingtalkLoadMore')}
                </button>
              )}
              {recent && loadingMore && (
                <div className="flex items-center justify-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('composer.dingtalkLoadingMore')}</span>
                </div>
              )}
            </div>
          </div>
          <OverlayScrollbar viewportRef={listRef} contentRef={listContentRef} />
        </div>
      )}
    </div>
  );

  return anchorRef ? createPortal(panel, document.body) : panel;
}
