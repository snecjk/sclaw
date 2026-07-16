/**
 * MoreAppsPage — 应用广场 main page
 * Aligned with the PRD demo (more-apps.js / more-apps.css)
 * 
 * Two views:
 * - Market tab: Hero carousel + category filters + row list
 * - Installed tab: Card grid layout
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Search, ExternalLink, Heart } from 'lucide-react';
import './more-apps.css';
import { toast } from 'sonner';
import { useMoreAppsStore } from '@/stores/more-apps';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  stoMainInnerShell,
  stoPageTitleClass,
} from '@/lib/surfaces';
import { AppCard } from './AppCard';
import { AddExternalAppModal } from './AddExternalAppModal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AppIcon } from './AppIcon';
import type { AppItem, AppPlazaBanner } from '@/types/more-apps';
import { MARKET_CATEGORIES } from './builtin-apps';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';

const HERO_CAROUSEL_INTERVAL = 5000;

export function MoreAppsPage() {
  const { t } = useTranslation('common');
  const {
    activeTab,
    searchQuery,
    marketCategory,
    heroSlideIndex,
    builtinApps,
    externalApps,
    favoriteIds,
    banners,
    bannersLoading,
    bannersError,
    setActiveTab,
    setSearchQuery,
    setMarketCategory,
    setHeroSlideIndex,
    fetchBanners,
    openAddModal,
    openEditModal,
    removeExternalApp,
    installApp,
    toggleFavorite,
    isAppInstalled,
    isAppFavorite,
  } = useMoreAppsStore();

  const [confirmDeleteApp, setConfirmDeleteApp] = useState<AppItem | null>(null);
  const [failedBannerImages, setFailedBannerImages] = useState<string[]>([]);
  const heroTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Merge builtin + external for display
  const allApps = useMemo(() => {
    return [...builtinApps, ...externalApps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [builtinApps, externalApps]);

  // Filter apps for market tab based on category and search
  const marketApps = useMemo(() => {
    let apps = allApps.filter((a) => !a.external);
    if (marketCategory !== 'featured') {
      apps = apps.filter((a) => a.category === marketCategory);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      apps = apps.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q),
      );
    }
    return apps;
  }, [allApps, marketCategory, searchQuery]);

  // My apps: external apps + favorited builtin apps only
  const installedApps = useMemo(() => {
    return allApps.filter((a) => a.external || favoriteIds.includes(a.id));
  }, [allApps, favoriteIds]);

  // Filter installed apps by search
  const filteredInstalledApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return installedApps;
    return installedApps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q),
    );
  }, [installedApps, searchQuery]);

  const marketAppCount = useMemo(
    () => allApps.filter((a) => !a.external).length,
    [allApps],
  );

  const installedAppCount = installedApps.length;

  // Load server banners on mount (Banner block is independent of 分类/APP).
  useEffect(() => {
    fetchBanners();
  }, [fetchBanners]);

  // Keep heroSlideIndex in range when the banner set changes (refetch / shrink).
  useEffect(() => {
    if (banners.length > 0 && heroSlideIndex >= banners.length) {
      setHeroSlideIndex(0);
    }
  }, [banners.length, heroSlideIndex, setHeroSlideIndex]);

  // Hero carousel auto-rotate
  useEffect(() => {
    if (activeTab !== 'market' || banners.length < 2) {
      if (heroTimerRef.current) {
        clearInterval(heroTimerRef.current);
        heroTimerRef.current = null;
      }
      return;
    }
    heroTimerRef.current = setInterval(() => {
      setHeroSlideIndex((heroSlideIndex + 1) % banners.length);
    }, HERO_CAROUSEL_INTERVAL);
    return () => {
      if (heroTimerRef.current) {
        clearInterval(heroTimerRef.current);
      }
    };
  }, [activeTab, heroSlideIndex, setHeroSlideIndex, banners]);

  const handleOpenApp = useCallback((app: AppItem) => {
    if (!app.url?.trim()) return;
    if (!isAppInstalled(app.id)) {
      installApp(app.id);
    }
    openInSclawBrowser({ url: app.url, title: app.name, appId: app.id });
  }, [installApp, isAppInstalled]);

  // Resolve a banner's click target against the currently loaded APP set.
  // APP-type is only clickable when targetAppId resolves to a loaded app's url;
  // never guess a URL when it cannot be resolved (Banner 整图内容 contract).
  const isBannerClickable = useCallback(
    (banner: AppPlazaBanner) => {
      if (banner.targetType === 'URL' && banner.targetUrl) return true;
      if (banner.targetType === 'APP' && banner.targetAppId) {
        return allApps.some((a) => a.id === banner.targetAppId && !!a.url?.trim());
      }
      return false;
    },
    [allApps],
  );

  const handleBannerClick = useCallback(
    (banner: AppPlazaBanner) => {
      if (banner.targetType === 'URL' && banner.targetUrl) {
        openInSclawBrowser({
          url: banner.targetUrl,
          title: banner.title || banner.subtitle || undefined,
        });
        return;
      }
      if (banner.targetType === 'APP' && banner.targetAppId) {
        const app = allApps.find((a) => a.id === banner.targetAppId);
        if (app?.url?.trim()) {
          handleOpenApp(app);
        }
        // Unresolvable APP target: keep showing the image but do not click — never guess the URL.
      }
      // NONE-type: no target, not clickable.
    },
    [allApps, handleOpenApp],
  );

  const handleBannerImageError = useCallback((bannerId: string) => {
    setFailedBannerImages((prev) => (prev.includes(bannerId) ? prev : [...prev, bannerId]));
  }, []);

  const handleDelete = useCallback((app: AppItem) => {
    setConfirmDeleteApp(app);
  }, []);

  const handleEdit = useCallback((app: AppItem) => {
    openEditModal(app.id);
  }, [openEditModal]);

  const confirmDelete = useCallback(() => {
    if (!confirmDeleteApp) return;
    removeExternalApp(confirmDeleteApp.id);
    toast.success(t('moreApps.toast.deleted', { defaultValue: '应用已删除' }), { duration: 2000 });
    setConfirmDeleteApp(null);
  }, [confirmDeleteApp, removeExternalApp, t]);

  const handleToggleFavorite = useCallback((id: string) => {
    toggleFavorite(id);
  }, [toggleFavorite]);

  // ── Banner carousel (server 整图) ─────────────────────────────
  // Renders server-configured banner images with independent loading / error /
  // empty / single / multi / image-failure handling. No static mock fallback.
  const renderBannerCarousel = () => {
    if (bannersLoading) {
      return (
        <div
          className="app-market__hero-carousel app-market__hero-carousel--loading"
          aria-busy="true"
          aria-label={t('moreApps.bannerLoading', { defaultValue: '横幅加载中' })}
        >
          <div className="app-market__hero-skeleton" />
        </div>
      );
    }
    if (bannersError) {
      return (
        <div className="app-market__hero-carousel app-market__hero-carousel--error" role="alert">
          <div className="app-market__hero-error">
            <span className="app-market__hero-error-text">
              {t('moreApps.bannerError', { defaultValue: '横幅加载失败' })}
            </span>
            <button type="button" className="app-market__hero-retry" onClick={() => fetchBanners()}>
              {t('moreApps.bannerRetry', { defaultValue: '重试' })}
            </button>
          </div>
        </div>
      );
    }
    if (banners.length === 0) return null;

    return (
      <div
        className="app-market__hero-carousel"
        aria-label={t('moreApps.bannerCarousel', { defaultValue: '精选推荐轮播' })}
      >
        <div className="app-market__hero-track">
          {banners.map((banner, idx) => {
            const active = idx === heroSlideIndex;
            const clickable = isBannerClickable(banner);
            const imageFailed = !banner.imageUrl || failedBannerImages.includes(banner.id);
            const altText =
              banner.title || banner.subtitle || t('moreApps.banner', { defaultValue: '横幅' });
            const bannerClassName = cn(
              'app-market__hero-banner',
              clickable && 'app-market__hero-banner--clickable',
            );
            const content = imageFailed ? (
              <div className="app-market__hero-image-fallback" aria-hidden="true">
                <span className="app-market__hero-image-fallback-text">{altText}</span>
              </div>
            ) : (
              <img
                className="app-market__hero-image"
                src={banner.imageUrl}
                alt={altText}
                loading="lazy"
                onError={() => handleBannerImageError(banner.id)}
              />
            );
            return (
              <section
                key={banner.id}
                className={cn(
                  'app-market__hero-slide',
                  active && 'app-market__hero-slide--active',
                )}
                data-hero-slide={idx}
                aria-hidden={!active}
              >
                {clickable ? (
                  <button
                    type="button"
                    className={bannerClassName}
                    onClick={() => handleBannerClick(banner)}
                    aria-label={altText}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={bannerClassName} aria-label={altText}>
                    {content}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {banners.length > 1 && (
          <div className="app-market__hero-dots" role="tablist" aria-label="横幅切换">
            {banners.map((banner, idx) => (
              <button
                key={banner.id}
                type="button"
                className={cn(
                  'app-market__hero-dot',
                  idx === heroSlideIndex && 'app-market__hero-dot--active',
                )}
                data-hero-dot={idx}
                aria-label={`切换到第 ${idx + 1} 张横幅`}
                aria-current={idx === heroSlideIndex ? 'true' : 'false'}
                onClick={() => setHeroSlideIndex(idx)}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Market Tab View ──────────────────────────────────────────
  const renderMarketView = () => {
    return (
      <>
        {/* Banner carousel (server 整图) */}
        {renderBannerCarousel()}

        {/* Category Filters */}
        <nav className="app-market__cats" aria-label="应用分类">
          {MARKET_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={cn('app-market__cat', marketCategory === cat.id && 'app-market__cat--active')}
              data-market-cat={cat.id}
              aria-pressed={marketCategory === cat.id ? 'true' : 'false'}
              onClick={() => setMarketCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        {/* App List */}
        {marketApps.length > 0 ? (
          <div className="app-market__grid">
            {marketApps.map((app) => {
              const installed = isAppInstalled(app.id);
              const favorite = isAppFavorite(app.id);
              return (
                <article
                  key={app.id}
                  className={cn('app-market__row', installed && 'app-market__row--installed')}
                  data-app-id={app.id}
                  onClick={() => handleOpenApp(app)}
                >
                  <div className="app-market__row-main">
                    <AppIcon iconKey={app.iconKey} iconUrl={app.iconUrl} tone={app.tone} size="lg" />
                    <div className="app-market__row-body">
                      <h4 className="app-market__row-title">{app.name}</h4>
                      <p className="app-market__row-desc">{app.description}</p>
                    </div>
                  </div>
                  <div className="app-market__row-aside">
                    {!app.external && (
                      <button
                        className={cn('app-market__row-favorite', favorite && 'app-market__row-favorite--active')}
                        onClick={(e) => { e.stopPropagation(); handleToggleFavorite(app.id); }}
                        aria-label={favorite ? t('moreApps.unfavorite', { defaultValue: '取消收藏' }) : t('moreApps.favorite', { defaultValue: '收藏' })}
                      >
                        <Heart className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
                      </button>
                    )}
                    <svg className="app-market__row-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="app-market__empty">
            {t('moreApps.emptyMarket', { defaultValue: '未找到匹配的应用，试试其他分类或关键词' })}
          </div>
        )}
      </>
    );
  };

  // ── Installed Tab View ───────────────────────────────────────
  const renderInstalledView = () => {
    return (
      <div className="more-apps-main">
        {filteredInstalledApps.length > 0 ? (
          <section className="more-apps-section">
            <div className="more-apps-grid">
              {filteredInstalledApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  isMineTab={true}
                  isInstalled
                  isFavorite={isAppFavorite(app.id)}
                  onOpen={handleOpenApp}
                  onInstall={installApp}
                  onDelete={app.external ? handleDelete : undefined}
                  onEdit={app.external ? handleEdit : undefined}
                  onToggleFavorite={!app.external ? handleToggleFavorite : undefined}
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="more-apps-empty">
            {searchQuery
              ? t('moreApps.emptySearch', { defaultValue: '未找到匹配的应用，试试其他关键词' })
              : t('moreApps.emptyInstalled', { defaultValue: '还没有收藏或安装应用，去应用广场看看' })}
          </div>
        )}
      </div>
    );
  };

  // ── Main Layout ──────────────────────────────────────────────
  return (
    <div className={cn(stoMainInnerShell, 'page-more-apps flex h-full flex-col', activeTab === 'market' && 'page-more-apps--market')}>
      {/* Header with title and subtitle */}
      <div className="app-plaza-hero">
        <h1 className={cn(stoPageTitleClass, 'app-plaza-hero__title')}>
          {t('moreApps.title', { defaultValue: '应用广场' })}
        </h1>
        <p className="app-plaza-hero__subtitle">
          {t('moreApps.subtitle', { defaultValue: '发现、安装与管理网点经营应用，像应用商店一样即装即用' })}
        </p>
      </div>

      {/* Toolbar Row: Tabs + Search + Add Button */}
      <div className="more-apps-toolbar-row">
        <div className="more-apps-tabs" role="tablist" aria-label={t('moreApps.tabAria', { defaultValue: '应用类型' })}>
          {(['market', 'installed'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={cn('more-apps-tab', activeTab === tab && 'more-apps-tab--active')}
              role="tab"
              data-tab={tab}
              onClick={() => setActiveTab(tab)}
              aria-selected={activeTab === tab}
            >
              <span className="more-apps-tab__label">
                {tab === 'market'
                  ? t('moreApps.tabMarket', { defaultValue: '应用广场' })
                  : t('moreApps.tabInstalled', { defaultValue: '我的应用' })}
              </span>
              <span className="more-apps-tab__count">
                {tab === 'market' ? marketAppCount : installedAppCount}
              </span>
            </button>
          ))}
        </div>

        <label className="more-apps-search-wrap">
          <span className="sr-only">{t('moreApps.search', { defaultValue: '搜索应用' })}</span>
          <Search className="more-apps-search__icon" aria-hidden="true" />
          <input
            type="search"
            className="more-apps-search"
            placeholder={t('moreApps.searchPlaceholder', { defaultValue: '搜索应用名称或关键词' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
          />
        </label>

        <button
          type="button"
          className="more-apps-add-btn"
          id="more-apps-add-external-btn"
          onClick={openAddModal}
        >
          <ExternalLink className="more-apps-add-btn__icon" aria-hidden="true" />
          {t('moreApps.addExternal', { defaultValue: '安装外部应用' })}
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
        {activeTab === 'market' ? renderMarketView() : renderInstalledView()}
      </div>

      {/* Modals */}
      <AddExternalAppModal />
      <ConfirmDialog
        open={!!confirmDeleteApp}
        title={t('moreApps.deleteConfirmTitle', { defaultValue: '删除应用' })}
        message={t('moreApps.deleteConfirmDesc', { defaultValue: '确定要删除该外部应用吗？此操作不可撤销。' })}
        confirmLabel={t('common.delete', { defaultValue: '删除' })}
        cancelLabel={t('common.cancel', { defaultValue: '取消' })}
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteApp(null)}
      />
    </div>
  );
}
