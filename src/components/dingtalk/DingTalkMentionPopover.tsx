import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getHostApiBase } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type { MentionSearchItem } from '@/types/dingtalk-mention';

const AVATAR_COLORS = ['#1677FF', '#13C2C2', '#52C41A', '#FA8C16', '#722ED1', '#EB2F96', '#2F54EB'];

function hashSeed(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

function getAvatarColor(seed: string): string {
  return AVATAR_COLORS[hashSeed(seed) % AVATAR_COLORS.length];
}

function getAvatarInitial(item: MentionSearchItem): string {
  const title = item.title.trim();
  if (!title) return '?';
  if (item.type === 'group') {
    return title.charAt(0);
  }
  if (/[\u4e00-\u9fff]/.test(title)) {
    return title.slice(-1);
  }
  return title.charAt(0).toUpperCase();
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
  const color = getAvatarColor(item.id || item.title);

  if (avatarSrc && !failed) {
    return (
      <img
        src={avatarSrc}
        alt={item.title}
        className="h-8 w-8 shrink-0 rounded-full object-cover bg-muted"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {initial}
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
  error?: string | null;
  needsAuth?: boolean;
  needsInstall?: boolean;
  activeIndex: number;
  onHoverIndex: (index: number) => void;
  onSelect: (item: MentionSearchItem) => void;
  onLogin?: () => void;
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
  error,
  needsAuth = false,
  needsInstall = false,
  activeIndex,
  onHoverIndex,
  onSelect,
  onLogin,
  onLoadMore,
}: DingTalkMentionPopoverProps) {
  const { t } = useTranslation('chat');
  const loadMoreLockRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="absolute left-0 bottom-full z-50 mb-2 w-[22rem] overflow-hidden rounded-2xl border border-glass-border glass p-1.5 shadow-lg">
      <div className="px-3 py-2 text-[11px] font-medium text-muted-foreground/80">
        {recent
          ? t('composer.dingtalkRecentTitle')
          : query.trim()
            ? t('composer.dingtalkMentionSearchTitle', { query: query.trim() })
            : t('composer.dingtalkMentionTitle')}
      </div>

      {needsInstall && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {t('composer.dingtalkNeedsInstall')}
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

      {!loading && !needsAuth && !needsInstall && !error && items.length === 0 && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          {t('composer.dingtalkNoResults')}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div
          ref={listRef}
          className="max-h-72 min-h-[12.5rem] overflow-y-auto overscroll-contain"
          onScroll={handleScroll}
        >
          {items.map((item, index) => (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              data-mention-index={index}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                index === activeIndex ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60',
              )}
              onMouseEnter={() => onHoverIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <MentionAvatar item={item} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                {item.subtitle && (
                  <div className="truncate text-xs text-muted-foreground">{item.subtitle}</div>
                )}
              </div>
            </button>
          ))}
          {recent && hasMore && !loadingMore && onLoadMore && (
            <button
              type="button"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
      )}
    </div>
  );
}
