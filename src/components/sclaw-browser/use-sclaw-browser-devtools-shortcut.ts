/**
 * F12 / Ctrl+Shift+I / ⌘⌥I — open embed webview DevTools (guest page, not SClaw shell).
 */
import { useEffect } from 'react';
import { openSclawBrowserDevTools } from '@/lib/sclaw-browser-host-api';

function isEmbedDevToolsShortcut(event: KeyboardEvent): boolean {
  // F12 (any platform)
  if (event.key === 'F12' && !event.altKey && !event.metaKey && !event.ctrlKey) return true;
  // Ctrl+Shift+I (Windows/Linux)
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i' && !event.metaKey) return true;
  // ⌘⌥I (macOS)
  if (event.metaKey && event.altKey && event.key.toLowerCase() === 'i' && !event.ctrlKey) return true;
  return false;
}

export function useSclawBrowserDevToolsShortcut(
  active: boolean,
  embedRuntimeId: string | null | undefined,
): void {
  useEffect(() => {
    if (!active || !embedRuntimeId || !window.electron) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isEmbedDevToolsShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      void openSclawBrowserDevTools(embedRuntimeId, { toggle: true });
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, embedRuntimeId]);
}
