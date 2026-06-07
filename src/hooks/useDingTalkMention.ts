import { useCallback, useEffect, useRef, useState } from 'react';
import { installDwsCli, loginDingTalk, searchDingTalkMentions } from '@/lib/host-api';
import type { ActiveMentionTrigger } from '@/lib/dingtalk-mention-composer';
import type { MentionSearchItem } from '@/types/dingtalk-mention';

const DEBOUNCE_MS = 250;
const RECENT_PAGE_SIZE = 10;

function mergeMentionItems(
  existing: MentionSearchItem[],
  incoming: MentionSearchItem[],
): MentionSearchItem[] {
  const seen = new Set(existing.map((item) => `${item.type}:${item.id}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function useDingTalkMention(trigger: ActiveMentionTrigger | null, enabled = true) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MentionSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loggingIn, setLoggingIn] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [recent, setRecent] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const requestIdRef = useRef(0);

  const activeTrigger = enabled ? trigger : null;

  useEffect(() => {
    if (!activeTrigger) {
      setOpen(false);
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setNeedsAuth(false);
      setNeedsInstall(false);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    setOpen(true);
    setActiveIndex(0);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setHasMore(false);
    setNextCursor(null);
    if (activeTrigger.query.trim()) {
      setRecent(false);
      setItems([]);
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const queryToSearch = activeTrigger.query.trim();
    const timer = window.setTimeout(async () => {
      try {
        const result = await searchDingTalkMentions(
          queryToSearch,
          queryToSearch ? 20 : RECENT_PAGE_SIZE,
        );
        if (requestIdRef.current !== requestId) return;
        setItems(result.items);
        setRecent(result.recent === true);
        setHasMore(result.hasMore === true);
        setNextCursor(result.nextCursor ?? null);
        setNeedsAuth(result.needsAuth === true);
        setNeedsInstall(result.needsInstall === true);
        setActiveIndex(0);
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        const message = err instanceof Error ? err.message : String(err);
        setItems([]);
        setHasMore(false);
        setNextCursor(null);
        setError(message);
        setNeedsAuth(message.includes('authenticated') || message.includes('needsAuth'));
        setNeedsInstall(message.includes('not installed') || message.includes('needsInstall'));
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTrigger?.query, activeTrigger?.endOffset, searchNonce]);

  const loadMore = useCallback(async () => {
    if (!recent || !hasMore || !nextCursor || loading || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    try {
      const result = await searchDingTalkMentions('', RECENT_PAGE_SIZE, nextCursor);
      if (requestIdRef.current !== requestId) return;
      setItems((prev) => mergeMentionItems(prev, result.items));
      setHasMore(result.hasMore === true);
      setNextCursor(result.nextCursor ?? null);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingMore(false);
      }
    }
  }, [recent, hasMore, nextCursor, loading, loadingMore]);

  const login = useCallback(async () => {
    setLoggingIn(true);
    setError(null);
    try {
      await loginDingTalk();
      setNeedsAuth(false);
      setSearchNonce((value) => value + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    try {
      const result = await installDwsCli();
      if (!result.success) {
        throw new Error(result.error || 'dws install failed');
      }
      setNeedsInstall(false);
      setSearchNonce((value) => value + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setInstalling(false);
    }
  }, []);

  const moveActive = useCallback((delta: number) => {
    setActiveIndex((prev) => {
      if (items.length === 0) return 0;
      return (prev + delta + items.length) % items.length;
    });
  }, [items.length]);

  const close = useCallback(() => {
    setOpen(false);
    setItems([]);
    setError(null);
    setHasMore(false);
    setNextCursor(null);
  }, []);

  return {
    open,
    trigger: activeTrigger,
    items,
    recent,
    loading,
    loadingMore,
    hasMore,
    error,
    needsAuth,
    needsInstall,
    activeIndex,
    setActiveIndex,
    moveActive,
    loadMore,
    close,
    login,
    loggingIn,
    install,
    installing,
  };
}
