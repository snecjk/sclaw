import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
        className="h-8 w-8 shrink-0 rounded-[8px] bg-[#DFEDFF] object-cover"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#DFEDFF] text-[12px] font-semibold leading-none text-[#1677FF]" aria-hidden>
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
      <div className="px-2 py-1 text-[12px] font-medium leading-5 text-[#86909C]">
        {title}
      </div>
      {items.length === 0 && emptyLabel ? (
        <div className="px-2 py-1 text-[12px] font-normal leading-5 text-[#C4CDD8]">
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
            item.sourceIndex === activeIndex ? 'bg-[#F0F2F5] text-[#1F2937]' : 'hover:bg-[#F5F7FA]',
          )}
          onMouseEnter={() => onHoverIndex(item.sourceIndex)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(item);
          }}
        >
          <MentionAvatar item={item} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-normal leading-5 text-[#111827]">{item.title}</div>
            {item.subtitle && (
              <div className="truncate text-[10px] font-normal leading-4 text-[#86909C]">{item.subtitle}</div>
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
}

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
}: DingTalkMentionPopoverProps) {
  const { t } = useTranslation('chat');
  const loadMoreLockRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const listContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || items.length === 0) return;
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(`[data-mention-index="${activeIndex}"]`);
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, items.length]);

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

  return (
    <div className="absolute left-0 bottom-full z-50 mb-2 w-[320px] overflow-hidden rounded-[8px] border border-[#E5E6EB] bg-white p-2 shadow-[0_4px_12px_rgba(0,0,0,0.1)] dark:border-border dark:bg-popover">
      <div className="px-2 py-1 text-[12px] font-medium leading-5 text-[#86909C]">
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
        <div className="space-y-2 px-3 py-2">
          <div className="text-sm text-muted-foreground">
            {t('composer.dingtalkNeedsAuth')}
          </div>
          {onLogin && (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onLogin}
              disabled={loggingIn}
            >
              {loggingIn ? t('composer.dingtalkLoggingIn') : t('composer.dingtalkLogin')}
            </button>
          )}
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
        <div className="px-2 py-1 text-[12px] text-[#86909C]">
          {t('composer.dingtalkNoResults')}
        </div>
      )}

      {!loading && !needsAuth && !needsInstall && !error && (hasVisibleItems || query.trim()) && (
        <div className="relative max-h-[336px] overflow-hidden">
          <div
            ref={listRef}
            className="sto-overlay-scroll-viewport max-h-[336px] overflow-y-auto overscroll-contain"
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
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[12px] font-medium text-[#86909C] transition-colors hover:bg-[#F0F2F5] hover:text-[#111827]"
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
}
