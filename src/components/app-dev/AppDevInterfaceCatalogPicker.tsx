import { useEffect, useLayoutEffect, useRef, useState, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  skillPickerHighlightClass,
  skillPickerListClass,
  skillPickerRowClass,
} from '@/lib/surfaces';
import { useAppDevInterfaceCatalogStore } from '@/stores/app-dev-interface-catalog';
import {
  filterSaiInterfaceCatalog,
  mergeCatalogLocalFirst,
  takeCatalogWindow,
  type SaiInterfaceCatalogItem,
} from '@/lib/sai-interface-catalog';
import type { RefObject } from 'react';

export interface AppDevInterfaceCatalogPickerProps {
  open: boolean;
  onSelect: (item: SaiInterfaceCatalogItem) => void;
  onClose: () => void;
  /** 锚定按钮：portal + fixed，浮在输入对话框上方 */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const DISCOVER_DEBOUNCE_MS = 320;

type PickerPosition = {
  left: number;
  bottom: number;
  width: number;
};

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const index = lower.indexOf(q.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className={skillPickerHighlightClass}>{text.slice(index, index + q.length)}</span>
      {text.slice(index + q.length)}
    </>
  );
}

export const AppDevInterfaceCatalogPicker = forwardRef<
  HTMLDivElement,
  AppDevInterfaceCatalogPickerProps
>(function AppDevInterfaceCatalogPicker(
  { open, onSelect, onClose, anchorRef, className },
  ref,
) {
  const listItems = useAppDevInterfaceCatalogStore((s) => s.listItems);
  const discoverItems = useAppDevInterfaceCatalogStore((s) => s.discoverItems);
  const visibleCount = useAppDevInterfaceCatalogStore((s) => s.visibleCount);
  const loading = useAppDevInterfaceCatalogStore((s) => s.loading);
  const discovering = useAppDevInterfaceCatalogStore((s) => s.discovering);
  const error = useAppDevInterfaceCatalogStore((s) => s.error);
  const discoverError = useAppDevInterfaceCatalogStore((s) => s.discoverError);
  const reload = useAppDevInterfaceCatalogStore((s) => s.reload);
  const loadMore = useAppDevInterfaceCatalogStore((s) => s.loadMore);
  const resetVisibleWindow = useAppDevInterfaceCatalogStore((s) => s.resetVisibleWindow);
  const discover = useAppDevInterfaceCatalogStore((s) => s.discover);
  const clear = useAppDevInterfaceCatalogStore((s) => s.clear);

  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = query.trim();
  const localMatched = filterSaiInterfaceCatalog(listItems, trimmedQuery);
  const matchedItems = trimmedQuery
    ? mergeCatalogLocalFirst(localMatched, discoverItems)
    : listItems;
  const displayItems = takeCatalogWindow(matchedItems, visibleCount);
  const hasMore = displayItems.length < matchedItems.length;

  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setQuery('');
        clear();
      }, 0);
      return () => clearTimeout(timer);
    }
    void reload();
    return undefined;
  }, [open, reload, clear]);

  useEffect(() => {
    if (!open) return undefined;
    resetVisibleWindow();
    const trimmed = query.trim();
    if (!trimmed) {
      void discover('');
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void discover(trimmed);
    }, DISCOVER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, discover, resetVisibleWindow]);

  useLayoutEffect(() => {
    if (!open || !anchorRef?.current) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = anchorRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const toolbar = button.closest('[data-composer-toolbar="true"]') as HTMLElement | null;
      const toolbarRect = toolbar?.getBoundingClientRect();
      const width = Math.min(
        Math.max(toolbarRect?.width ?? 360, 280),
        window.innerWidth - 24,
      );
      const preferredLeft = toolbarRect ? toolbarRect.left : rect.left;
      const left = Math.min(
        Math.max(12, preferredLeft),
        window.innerWidth - width - 12,
      );
      setPosition({
        left,
        bottom: window.innerHeight - rect.top + 8,
        width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open || loading) return undefined;
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return undefined;

    const matchedTotal = matchedItems.length;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore(matchedTotal);
        }
      },
      { root, rootMargin: '48px', threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [open, loading, loadMore, matchedItems.length, visibleCount, hasMore]);

  if (!open) return null;

  const setRefs = (node: HTMLDivElement | null) => {
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  const panel = (
    <div
      ref={setRefs}
      role="listbox"
      aria-label="接口清单"
      className={cn(
        // AppPlazaDevAppPane 全屏层 zIndex=240，气泡必须更高
        'z-[260] overflow-hidden rounded-2xl border border-glass-border glass p-2 shadow-lg',
        position ? 'fixed' : 'absolute left-0 bottom-full mb-2 w-[360px]',
        className,
      )}
      style={
        position
          ? {
              left: position.left,
              bottom: position.bottom,
              width: position.width,
              zIndex: 260,
            }
          : { zIndex: 260 }
      }
    >
      <div className="flex h-9 items-center justify-between gap-2 px-3">
        <p className="text-[11px] font-medium text-muted-foreground/80">接口清单</p>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
          disabled={loading}
          onClick={() => void reload()}
        >
          刷新
        </button>
      </div>
      <div className="px-2 pb-2">
        <label className="relative flex h-8 items-center">
          <Search
            className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索中文名称或描述"
            className="h-8 w-full rounded-xl border border-border bg-background/80 pl-8 pr-3 text-xs leading-8 outline-none focus:border-primary/40"
            autoFocus
            disabled={loading && listItems.length === 0}
          />
        </label>
      </div>
      <div ref={listRef} className={skillPickerListClass}>
        {loading && listItems.length === 0 ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            正在加载全部接口…
          </div>
        ) : error && listItems.length === 0 ? (
          <div className="space-y-2 px-3 py-6 text-center text-xs text-muted-foreground">
            <p className="text-destructive">{error}</p>
            <button
              type="button"
              className="underline"
              onClick={() => void reload()}
            >
              重试
            </button>
          </div>
        ) : displayItems.length === 0 && !discovering ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {trimmedQuery ? '没有匹配的接口' : '暂无接口'}
          </p>
        ) : (
          <>
            {trimmedQuery && discovering ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                语义搜索中…
              </div>
            ) : null}
            {trimmedQuery && discoverError ? (
              <p className="px-3 py-1 text-[11px] text-destructive">{discoverError}</p>
            ) : null}
            {displayItems.map((item) => {
              const secondary = item.description.trim() || item.path;
              const tip = [item.description, item.path].filter(Boolean).join('\n');
              return (
                <button
                  key={item.path}
                  type="button"
                  role="option"
                  title={tip}
                  className={cn(skillPickerRowClass, 'flex-col items-stretch gap-1')}
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                >
                  <p className="truncate text-left text-sm font-medium leading-5 text-foreground">
                    <Highlight text={item.name} query={query} />
                  </p>
                  <p className="truncate text-left text-[11px] leading-4 text-muted-foreground/80">
                    <Highlight text={secondary} query={query} />
                  </p>
                </button>
              );
            })}
            <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
            {hasMore ? (
              <p className="px-3 py-2 text-center text-[11px] text-muted-foreground/70">
                下滑加载更多（{displayItems.length}/{matchedItems.length}）
              </p>
            ) : matchedItems.length > 0 ? (
              <p className="px-3 py-2 text-center text-[11px] text-muted-foreground/70">
                {trimmedQuery
                  ? `共 ${matchedItems.length} 条匹配`
                  : `已加载全部（${matchedItems.length}）`}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  if (anchorRef) {
    return createPortal(panel, document.body);
  }
  return panel;
});
