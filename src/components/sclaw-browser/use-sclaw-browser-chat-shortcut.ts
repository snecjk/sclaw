/**
 * ⌘L / Ctrl+L — toggle embed AI chat while the app-square browser drawer is open.
 */
import { useEffect } from 'react';
import { isSclawBrowserEmbedChatShortcut } from '../../../shared/sclaw-embed-browser-shortcut';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';

function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('.sclaw-browser-embed-chat')) return false;
  if (target.closest('.sclaw-browser-toolbar')) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return !target.closest('.sclaw-browser-host');
  }
  return false;
}

export function useSclawBrowserChatShortcut(active: boolean): void {
  const toggleChatPanel = useSclawBrowserOverlayStore((s) => s.toggleChatPanel);

  useEffect(() => {
    if (!active) return;

    const handleToggle = () => {
      toggleChatPanel();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const platform = window.electron?.platform ?? navigator.platform.toLowerCase();
      if (!isSclawBrowserEmbedChatShortcut(event, platform)) return;
      if (shouldIgnoreShortcutTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      handleToggle();
    };

    window.addEventListener('keydown', onKeyDown, true);

    const unsubscribeIpc = window.electron?.ipcRenderer.on(
      'sclaw-browser:toggle-chat',
      handleToggle,
    );

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      unsubscribeIpc?.();
    };
  }, [active, toggleChatPanel]);
}
