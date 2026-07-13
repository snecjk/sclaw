/**
 * SClawBrowserDrawer — toolbar + panel portaled to body; host keeps backdrop only.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { closeSclawBrowser } from '@/lib/open-sclaw-browser';
import { useSclawBrowserOverlayStore } from '@/stores/sclaw-browser-overlay';
import { SclawBrowserPanelPortal } from './SclawBrowserPanelPortal';
import { SclawBrowserToolbarPortal } from './SclawBrowserToolbarPortal';
import './sclaw-browser-overlay.css';

export function SclawBrowserDrawer() {
  const { t } = useTranslation('common');
  const session = useSclawBrowserOverlayStore((s) => s.session);
  const toggleChatPanel = useSclawBrowserOverlayStore((s) => s.toggleChatPanel);

  useEffect(() => {
    if (!session) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const mod = window.electron?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
      if (!mod || event.key.toLowerCase() !== 'l') return;
      if (event.altKey) return;
      event.preventDefault();
      toggleChatPanel();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, toggleChatPanel]);

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
