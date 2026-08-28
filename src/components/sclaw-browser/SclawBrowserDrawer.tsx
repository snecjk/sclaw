/**
 * SClawBrowserDrawer — toolbar + panel portaled to body; host keeps backdrop only.
 */
import { useTranslation } from 'react-i18next';
import { closeSclawBrowser } from '@/lib/open-sclaw-browser';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { SclawBrowserPanelPortal } from './SclawBrowserPanelPortal';
import { SclawBrowserToolbarPortal } from './SclawBrowserToolbarPortal';
import { useSclawBrowserChatShortcut } from './use-sclaw-browser-chat-shortcut';
import { useSclawBrowserDevToolsShortcut } from './use-sclaw-browser-devtools-shortcut';
import './sclaw-browser-overlay.css';

export function SclawBrowserDrawer() {
  const { t } = useTranslation('common');
  const session = useSclawBrowserOverlayStore((s) => s.session);
  const embedRuntimeId = useSclawBrowserOverlayStore((s) => s.embedRuntimeId);

  useSclawBrowserChatShortcut(session !== null);
  useSclawBrowserDevToolsShortcut(session !== null, embedRuntimeId);

  if (!session) return null;

  return (
    <>
      <SclawBrowserToolbarPortal />
      <SclawBrowserPanelPortal />
      <button
        type="button"
        className="sclaw-browser-drawer__backdrop"
        aria-label={t('moreApps.back', { defaultValue: '返回' })}
        onClick={closeSclawBrowser}
      />
    </>
  );
}
