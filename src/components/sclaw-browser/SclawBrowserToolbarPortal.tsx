/**
 * Toolbar portaled to document.body — escapes Electron iframe native layer + drag-region.
 */
import { createPortal } from 'react-dom';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  closeSclawBrowser,
  openSclawBrowserInSystemBrowser,
} from '@/lib/open-sclaw-browser';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { useSclawBrowserHostBounds } from './use-sclaw-browser-host-bounds';
import { cn } from '@/lib/utils';
import './sclaw-browser-overlay.css';

function embedChatShortcutLabel(): string {
  const isMac = window.electron?.platform === 'darwin';
  return isMac ? '⌘L' : 'Ctrl+L';
}

export function SclawBrowserToolbarPortal() {
  const { t } = useTranslation('common');
  const session = useSclawBrowserOverlayStore((s) => s.session);
  const chatPanelOpen = useSclawBrowserOverlayStore((s) => s.chatPanelOpen);
  const toggleChatPanel = useSclawBrowserOverlayStore((s) => s.toggleChatPanel);
  const bounds = useSclawBrowserHostBounds(session !== null);

  if (!session || !bounds) return null;

  const shortcut = embedChatShortcutLabel();

  return createPortal(
    <header
      className="sclaw-browser-toolbar sclaw-browser-toolbar--portal no-drag"
      style={{
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
      }}
      aria-label={session.title}
    >
      <div className="sclaw-browser-toolbar__start">
        <button
          type="button"
          className="sclaw-browser-toolbar__back no-drag"
          onClick={closeSclawBrowser}
          aria-label={t('moreApps.back', { defaultValue: '返回' })}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('moreApps.back', { defaultValue: '返回' })}
        </button>
        <span className="sclaw-browser-toolbar__title">{session.title}</span>
      </div>
      <div className="sclaw-browser-toolbar__end">
        <button
          type="button"
          className="sclaw-browser-toolbar__external no-drag"
          onClick={openSclawBrowserInSystemBrowser}
        >
          {t('moreApps.openInSystemBrowser', { defaultValue: '在系统浏览器打开' })}
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className={cn(
            'sclaw-browser-toolbar__chat no-drag',
            chatPanelOpen && 'sclaw-browser-toolbar__chat--active',
          )}
          onClick={toggleChatPanel}
          aria-pressed={chatPanelOpen}
          aria-label={t('moreApps.embedChat.toggle', { defaultValue: '打开 AI 对话' })}
          title={t('moreApps.embedChat.toggleWithShortcut', {
            defaultValue: 'AI 对话 ({{shortcut}})',
            shortcut,
          })}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </header>,
    document.body,
  );
}
