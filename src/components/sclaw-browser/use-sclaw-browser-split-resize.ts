/**
 * Horizontal split resize for browser drawer (browser | chat).
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const MIN_CHAT_PERCENT = 28;
const MAX_CHAT_PERCENT = 55;

export function useSclawBrowserSplitResize(
  chatSplitPercent: number,
  setChatSplitPercent: (percent: number) => void,
  enabled: boolean,
) {
  const splitRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const percentRef = useRef(chatSplitPercent);

  percentRef.current = chatSplitPercent;

  useLayoutEffect(() => {
    const root = splitRef.current;
    if (!root || !enabled) {
      root?.style.removeProperty('--sclaw-browser-chat-col');
      return;
    }
    root.style.setProperty('--sclaw-browser-chat-col', `${chatSplitPercent}%`);
  }, [chatSplitPercent, enabled]);

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const root = splitRef.current;
    if (!root) return;

    isResizingRef.current = true;
    setIsResizing(true);

    const onMove = (moveEvent: MouseEvent) => {
      const rect = root.getBoundingClientRect();
      const width = rect.width;
      if (width <= 0) return;
      const chatPx = rect.right - moveEvent.clientX;
      const next = Math.min(MAX_CHAT_PERCENT, Math.max(MIN_CHAT_PERCENT, (chatPx / width) * 100));
      percentRef.current = next;
      root.style.setProperty('--sclaw-browser-chat-col', `${next}%`);
    };

    const onUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      setChatSplitPercent(percentRef.current);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setChatSplitPercent]);

  return { splitRef, startResize, isResizing };
}
