/**
 * Single browser tab workspace: editable address bar + fav highlight + webview (+ AI chat).
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ExternalLink, Heart, MessageCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { openSclawBrowserTabInSystemBrowser } from '@/lib/open-sclaw-browser';
import { normalizeAppPlazaTabUrl } from '@/lib/app-plaza-tab-url';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';
import { sclawBrowserEmbedChatShortcutLabel } from '../../../shared/sclaw-embed-browser-shortcut';
import {
  SclawBrowserFrame,
  type SclawBrowserFrameHandle,
} from '@/components/sclaw-browser/SclawBrowserFrame';
import { SclawBrowserEmbedChat } from '@/components/sclaw-browser/SclawBrowserEmbedChat';
import { useSclawBrowserSplitResize } from '@/components/sclaw-browser/use-sclaw-browser-split-resize';
import {
  type AppPlazaBrowserTab,
  useAppPlazaShellStore,
} from '@/stores/app-plaza-shell';
import { useMoreAppsStore } from '@/stores/more-apps';
import '@/components/sclaw-browser/sclaw-browser-overlay.css';

interface AppPlazaBrowserPaneProps {
  tab: AppPlazaBrowserTab;
  active: boolean;
}

function resolveFavorited(tab: AppPlazaBrowserTab): boolean {
  const favoriteIds = useMoreAppsStore.getState().favoriteIds;
  const externalApps = useMoreAppsStore.getState().externalApps;
  const catalogApps = useMoreAppsStore.getState().catalogApps;

  const registryId = tab.registryAppId || tab.appId;
  if (registryId) {
    if (favoriteIds.includes(registryId)) return true;
    if (externalApps.some((app) => app.id === registryId)) return true;
  }

  const pathKey = (() => {
    try {
      const parsed = new URL(tab.url);
      const path = parsed.pathname.length > 1
        ? parsed.pathname.replace(/\/+$/, '')
        : (parsed.pathname || '/');
      return `${parsed.origin}${path || '/'}`.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (!pathKey) return false;

  const catalogHit = catalogApps.find((app) => {
    if (!app.url || !favoriteIds.includes(app.id)) return false;
    try {
      const u = new URL(app.url);
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : (u.pathname || '/');
      return `${u.origin}${path || '/'}`.toLowerCase() === pathKey;
    } catch {
      return false;
    }
  });
  if (catalogHit) return true;

  return externalApps.some((app) => {
    try {
      const u = new URL(app.url);
      const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : (u.pathname || '/');
      return `${u.origin}${path || '/'}`.toLowerCase() === pathKey;
    } catch {
      return false;
    }
  });
}

export function AppPlazaBrowserPane({ tab, active }: AppPlazaBrowserPaneProps) {
  const { t } = useTranslation('common');
  const toggleChatPanel = useAppPlazaShellStore((s) => s.toggleChatPanel);
  const closeChatPanel = useAppPlazaShellStore((s) => s.closeChatPanel);
  const setChatSplitPercent = useAppPlazaShellStore((s) => s.setChatSplitPercent);
  const createChatSession = useAppPlazaShellStore((s) => s.createChatSession);
  const switchChatSession = useAppPlazaShellStore((s) => s.switchChatSession);
  const deleteChatSession = useAppPlazaShellStore((s) => s.deleteChatSession);
  const refreshChatSessions = useAppPlazaShellStore((s) => s.refreshChatSessions);
  const promoteTabBound = useAppPlazaShellStore((s) => s.promoteTabBound);
  const submitBlankTabUrl = useAppPlazaShellStore((s) => s.submitBlankTabUrl);
  const navigateBrowserTabUrl = useAppPlazaShellStore((s) => s.navigateBrowserTabUrl);
  const updateTabPageMeta = useAppPlazaShellStore((s) => s.updateTabPageMeta);

  const externalApps = useMoreAppsStore((s) => s.externalApps);
  const favoriteIds = useMoreAppsStore((s) => s.favoriteIds);
  const catalogApps = useMoreAppsStore((s) => s.catalogApps);
  const addExternalApp = useMoreAppsStore((s) => s.addExternalApp);
  const toggleFavorite = useMoreAppsStore((s) => s.toggleFavorite);
  const removeExternalApp = useMoreAppsStore((s) => s.removeExternalApp);
  const updateExternalAppIcon = useMoreAppsStore((s) => s.updateExternalAppIcon);
  const hydrated = useMoreAppsStore((s) => s.hydrated);

  const [blankDraft, setBlankDraft] = useState('');
  const [addressDraft, setAddressDraft] = useState(tab.url);
  const [canGoBack, setCanGoBack] = useState(false);
  const frameRef = useRef<SclawBrowserFrameHandle>(null);

  useEffect(() => {
    setAddressDraft(tab.url);
  }, [tab.url, tab.id]);

  useEffect(() => {
    setCanGoBack(false);
  }, [tab.id]);

  const { splitRef, startResize, isResizing } = useSclawBrowserSplitResize(
    tab.chatSplitPercent,
    (percent) => setChatSplitPercent(percent, tab.id),
    tab.chatPanelOpen && active,
    tab.embedRuntimeId,
  );

  // Re-compute when favorites / registry change
  void favoriteIds;
  void externalApps;
  void catalogApps;
  const isFavorited = resolveFavorited(tab);

  const normalizedUrl = normalizeAppPlazaTabUrl(tab.url);
  const matchedCatalog = catalogApps.find((app) => {
    if (!app.url) return false;
    if (app.id === tab.appId) return true;
    return normalizeAppPlazaTabUrl(app.url) === normalizedUrl;
  });
  const matchedExternal = externalApps.find((app) => {
    if (app.id === tab.appId) return true;
    return normalizeAppPlazaTabUrl(app.url) === normalizedUrl;
  });

  const shortcut = sclawBrowserEmbedChatShortcutLabel(window.electron?.platform ?? 'darwin');

  const handleFavorite = () => {
    if (!hydrated || !tab.url) return;

    if (matchedCatalog) {
      const wasFav = favoriteIds.includes(matchedCatalog.id);
      toggleFavorite(matchedCatalog.id);
      if (!wasFav) promoteTabBound(tab.id, matchedCatalog.id, matchedCatalog.name);
      toast.success(
        wasFav
          ? t('moreApps.toast.unfavorited', { defaultValue: '已取消收藏' })
          : t('moreApps.toast.favorited', { defaultValue: '已收藏到我的应用' }),
        { duration: 2000 },
      );
      return;
    }

    if (matchedExternal) {
      removeExternalApp(matchedExternal.id);
      toast.success(t('moreApps.toast.unfavorited', { defaultValue: '已取消收藏' }), { duration: 2000 });
      return;
    }

    const createdId = addExternalApp({
      name: tab.title || normalizedUrl,
      url: tab.url,
      description: t('moreApps.externalFromBrowser', { defaultValue: '从浏览器页签收藏' }),
      id: tab.appId || undefined,
      // If this tab already loaded a page favicon, persist it immediately.
      iconUrl: tab.pageFaviconUrl,
    });

    if (createdId) {
      promoteTabBound(tab.id, createdId, tab.title);
    } else {
      promoteTabBound(tab.id, tab.appId, tab.title);
    }
    toast.success(t('moreApps.toast.favorited', { defaultValue: '已收藏到我的应用' }), { duration: 2000 });
  };

  const commitAddress = () => {
    const next = addressDraft.trim();
    if (!next) return;
    navigateBrowserTabUrl(tab.id, next);
  };

  if (tab.status === 'blank') {
    return (
      <div className="app-plaza-blank" hidden={!active}>
        <form
          className="app-plaza-blank__form"
          onSubmit={(event) => {
            event.preventDefault();
            submitBlankTabUrl(tab.id, blankDraft);
          }}
        >
          <p className="app-plaza-blank__hint">
            {t('moreApps.browserTabs.blankHint', { defaultValue: '输入网址，在应用广场内打开' })}
          </p>
          <input
            className="app-plaza-blank__input"
            value={blankDraft}
            onChange={(event) => setBlankDraft(event.target.value)}
            placeholder="https://"
            autoFocus={active}
            aria-label={t('moreApps.browserTabs.urlAria', { defaultValue: '网址' })}
          />
        </form>
      </div>
    );
  }

  if (tab.status === 'suspended') {
    return (
      <div className="app-plaza-suspended-placeholder" hidden={!active}>
        {t('moreApps.browserTabs.suspendedBody', { defaultValue: '页签已暂停以节省内存，重新选中将重新加载' })}
      </div>
    );
  }

  return (
    <div className="app-plaza-shell__browser-pane flex h-full min-h-0 flex-col" hidden={!active}>
      <header className="app-plaza-browser-toolbar">
        <div className="app-plaza-browser-toolbar__nav">
          <button
            type="button"
            className="app-plaza-browser-toolbar__nav-btn"
            disabled={!canGoBack}
            onClick={() => frameRef.current?.goBack()}
            title={t('moreApps.browserTabs.back', { defaultValue: '返回上一页' })}
            aria-label={t('moreApps.browserTabs.back', { defaultValue: '返回上一页' })}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className="app-plaza-browser-toolbar__nav-btn"
            onClick={() => frameRef.current?.reload()}
            title={t('moreApps.browserTabs.reload', { defaultValue: '刷新' })}
            aria-label={t('moreApps.browserTabs.reload', { defaultValue: '刷新' })}
          >
            <RotateCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <form
          className={cn(
            'app-plaza-browser-address',
            isFavorited && 'app-plaza-browser-address--favorited',
          )}
          onSubmit={(event) => {
            event.preventDefault();
            commitAddress();
          }}
        >
          <input
            className="app-plaza-browser-toolbar__url"
            value={addressDraft}
            onChange={(event) => setAddressDraft(event.target.value)}
            onBlur={() => {
              if (addressDraft.trim() && addressDraft.trim() !== tab.url) {
                commitAddress();
              } else {
                setAddressDraft(tab.url);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAddressDraft(tab.url);
                (event.target as HTMLInputElement).blur();
              }
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={t('moreApps.browserTabs.urlAria', { defaultValue: '网址' })}
          />
          <button
            type="button"
            className={cn(
              'app-plaza-browser-toolbar__fav',
              isFavorited && 'app-plaza-browser-toolbar__fav--on',
            )}
            onClick={handleFavorite}
            aria-pressed={isFavorited}
            title={
              isFavorited
                ? t('moreApps.browserTabs.unfavorite', { defaultValue: '取消收藏' })
                : t('moreApps.browserTabs.favorite', { defaultValue: '收藏到我的应用' })
            }
          >
            <Heart
              className={cn('h-3.5 w-3.5', isFavorited && 'fill-current')}
              aria-hidden
            />
          </button>
        </form>
        <button
          type="button"
          className="app-plaza-browser-toolbar__btn"
          onClick={() => {
            void openSclawBrowserTabInSystemBrowser(tab);
          }}
        >
          {t('moreApps.openInSystemBrowser', { defaultValue: '在系统浏览器打开' })}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={cn(
            'app-plaza-browser-toolbar__btn',
            tab.chatPanelOpen && 'app-plaza-browser-toolbar__btn--active',
          )}
          onClick={() => toggleChatPanel(tab.id)}
          aria-pressed={tab.chatPanelOpen}
          title={t('moreApps.embedChat.toggleWithShortcut', {
            defaultValue: 'AI 对话 ({{shortcut}})',
            shortcut,
          })}
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <div
        ref={active ? splitRef : undefined}
        className={
          tab.chatPanelOpen
            ? `sclaw-browser-split flex-1 min-h-0${isResizing ? ' sclaw-browser-split--resizing' : ''}`
            : 'sclaw-browser-split sclaw-browser-split--browser-only flex-1 min-h-0'
        }
      >
        <div className="sclaw-browser-split__browser">
          {tab.embedRuntimeId ? (
            <SclawBrowserFrame
              ref={frameRef}
              key={`${tab.id}:${tab.url}`}
              url={tab.url}
              title={tab.title}
              embedRuntimeId={tab.embedRuntimeId}
              active={active}
              onOpenWindow={(nextUrl) => openInSclawBrowser({ url: nextUrl })}
              onNavStateChange={({ canGoBack: next }) => setCanGoBack(next)}
              onPageFavicon={(faviconUrl) => {
                updateTabPageMeta(tab.id, { pageFaviconUrl: faviconUrl });
                // After first visit, use page favicon as 我的应用 card icon.
                const registryId = tab.registryAppId || matchedExternal?.id;
                if (registryId && useMoreAppsStore.getState().externalApps.some((app) => app.id === registryId)) {
                  updateExternalAppIcon(registryId, faviconUrl);
                }
              }}
              onPageTitle={(pageTitle) => {
                updateTabPageMeta(tab.id, { title: pageTitle });
              }}
            />
          ) : null}
        </div>
        {tab.chatPanelOpen && tab.chatSessionKey ? (
          <>
            <button
              type="button"
              className="sclaw-browser-split__resizer"
              aria-label="Resize chat panel"
              onPointerDown={startResize}
            />
            <div className="sclaw-browser-split__chat">
              <SclawBrowserEmbedChat
                sessionKey={tab.chatSessionKey}
                appTitle={tab.title}
                onClose={() => closeChatPanel(tab.id)}
                sessionsProps={{
                  chatSessionKey: tab.chatSessionKey,
                  chatSessions: tab.chatSessions,
                  createChatSession: () => createChatSession(tab.id),
                  switchChatSession: (key) => switchChatSession(key, tab.id),
                  deleteChatSession: (key) => deleteChatSession(key, tab.id),
                  refreshChatSessions: () => refreshChatSessions(tab.id),
                }}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
