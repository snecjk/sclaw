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
import { getAppIcon } from './app-icons';
import type { AppItem } from '@/types/more-apps';
import { MARKET_CATEGORIES, MARKET_HERO_SLIDES } from './builtin-apps';

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
    installedIds,
    favoriteIds,
    drilledApp,
    setActiveTab,
    setSearchQuery,
    setMarketCategory,
    setHeroSlideIndex,
    openAddModal,
    removeExternalApp,
    drillToApp,
    drillBack,
    installApp,
    toggleFavorite,
    isAppInstalled,
    isAppFavorite,
  } = useMoreAppsStore();

  const [confirmDeleteApp, setConfirmDeleteApp] = useState<AppItem | null>(null);
  const heroTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Merge builtin + external for display
  const allApps = useMemo(() => {
    return [...builtinApps, ...externalApps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [builtinApps, externalApps]);

  // Filter apps for market tab based on category and search
  const marketApps = useMemo(() => {
    let apps = allApps.filter((a) => !a.external);
    if (marketCategory !== 'featured') {
      apps = apps.filter((a) => a.marketCategory === marketCategory);
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

  // Installed apps (based on installedIds)
  const installedApps = useMemo(() => {
    return allApps.filter((a) => installedIds.includes(a.id) || a.external);
  }, [allApps, installedIds]);

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

  const featuredApps = useMemo(() => {
    return allApps.filter((a) => a.recommended).slice(0, 4);
  }, [allApps]);

  // Hero carousel auto-rotate
  useEffect(() => {
    if (activeTab !== 'market' || MARKET_HERO_SLIDES.length < 2) {
      if (heroTimerRef.current) {
        clearInterval(heroTimerRef.current);
        heroTimerRef.current = null;
      }
      return;
    }
    heroTimerRef.current = setInterval(() => {
      setHeroSlideIndex((heroSlideIndex + 1) % MARKET_HERO_SLIDES.length);
    }, HERO_CAROUSEL_INTERVAL);
    return () => {
      if (heroTimerRef.current) {
        clearInterval(heroTimerRef.current);
      }
    };
  }, [activeTab, heroSlideIndex, setHeroSlideIndex]);

  const handleOpenApp = useCallback((app: AppItem) => {
    if (!isAppInstalled(app.id)) {
      installApp(app.id);
    }
    window.open(app.url, '_blank', 'noopener,noreferrer');
  }, [installApp, isAppInstalled]);

  const handleDelete = useCallback((app: AppItem) => {
    setConfirmDeleteApp(app);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!confirmDeleteApp) return;
    removeExternalApp(confirmDeleteApp.id);
    toast.success(t('moreApps.toast.deleted', { defaultValue: '应用已删除' }), { duration: 2000 });
    setConfirmDeleteApp(null);
  }, [confirmDeleteApp, removeExternalApp, t]);

  const handleToggleFavorite = useCallback((id: string) => {
    toggleFavorite(id);
  }, [toggleFavorite]);

  // ── Drilled (iframe) view ────────────────────────────────────
  if (drilledApp) {
    return (
      <div className={cn(stoMainInnerShell, 'flex h-full flex-col py-4')}>
        {/* Drill toolbar */}
        <div className="more-apps-drill__nav">
          <div className="more-apps-drill__nav-start">
            <button
              onClick={drillBack}
              className="more-apps-drill__back"
              aria-label={t('moreApps.back', { defaultValue: '返回' })}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {t('moreApps.back', { defaultValue: '返回' })}
            </button>
            <span className="more-apps-drill__crumb">{drilledApp.name}</span>
          </div>
          <a
            href={drilledApp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="more-apps-drill__external"
          >
            {t('moreApps.openExternal', { defaultValue: '在新窗口打开' })}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </a>
        </div>
        {/* Iframe container */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-[18px] bg-[#F7F8FA] shadow-[0_0_16px_0_rgba(0,0,0,0.01)]">
          <iframe
            src={drilledApp.url}
            title={drilledApp.name}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    );
  }

  // ── Market Tab View ──────────────────────────────────────────
  const renderMarketView = () => {
    const currentSlide = MARKET_HERO_SLIDES[heroSlideIndex] || MARKET_HERO_SLIDES[0];
    const heroApp = allApps.find((a) => a.id === currentSlide?.appId);

    return (
      <>
        {/* Hero Carousel */}
        {MARKET_HERO_SLIDES.length > 0 && heroApp && (
          <div className="app-market__hero-carousel" aria-label="精选推荐轮播">
            <div className="app-market__hero-track">
              {MARKET_HERO_SLIDES.map((slide, idx) => {
                const slideApp = allApps.find((a) => a.id === slide.appId);
                if (!slideApp) return null;
                const active = idx === heroSlideIndex;
                return (
                  <section
                    key={slide.appId}
                    className={cn(
                      'app-market__hero-slide',
                      active && 'app-market__hero-slide--active',
                    )}
                    data-hero-slide={idx}
                    aria-hidden={!active}
                  >
                    <div className={cn('app-market__hero', slide.theme ? `app-market__hero--${slide.theme}` : '')}>
                    <div className="app-market__hero-inner">
                      <div className="app-market__hero-copy">
                        <div className="app-market__hero-head">
                          <span
                            className={cn('app-icon app-icon--lg', `app-icon--tone-${slideApp.tone || 'gray'}`)}
                            dangerouslySetInnerHTML={{ __html: getAppIcon(slideApp.iconKey) }}
                          />
                          <div className="app-market__hero-text">
                            <h3 className="app-market__hero-title">
                              <span className="app-market__hero-title-main">{slideApp.name}</span>
                              <span className="app-market__hero-title-sub">{slide.subtitle}</span>
                            </h3>
                            <button
                              className={cn('app-market__hero-cta', isAppInstalled(slideApp.id) ? 'app-market__hero-cta--view' : '')}
                              onClick={() => handleOpenApp(slideApp)}
                            >
                              {isAppInstalled(slideApp.id) ? t('moreApps.open', { defaultValue: '打开' }) : t('moreApps.install', { defaultValue: '打开' })}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="app-market__hero-visual" aria-hidden="true">
                        <div className="app-market__hero-card">
                          <div className="app-market__hero-preview">
                            <div className="app-market__hero-preview-head">
                              <span
                                className={cn('app-icon app-icon--sm', `app-icon--tone-${slideApp.tone || 'gray'}`)}
                                dangerouslySetInnerHTML={{ __html: getAppIcon(slideApp.iconKey) }}
                              />
                              <div className="app-market__hero-preview-meta">
                                <strong className="app-market__hero-preview-title">{slideApp.name}</strong>
                                <span className="app-market__hero-preview-tag">{t('moreApps.official', { defaultValue: '官方应用' })}</span>
                              </div>
                            </div>
                            <div className="app-market__hero-preview-stats">
                              {slide.stats.map((stat, i) => (
                                <span key={i} className="app-market__hero-stat">
                                  <em>{stat.label}</em>
                                  <strong>{stat.value}</strong>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                  </section>
                );
              })}
            </div>
            {MARKET_HERO_SLIDES.length > 1 && (
              <div className="app-market__hero-dots" role="tablist" aria-label="横幅切换">
                {MARKET_HERO_SLIDES.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={cn('app-market__hero-dot', idx === heroSlideIndex && 'app-market__hero-dot--active')}
                    data-hero-dot={idx}
                    aria-label={`切换到第 ${idx + 1} 张横幅`}
                    aria-current={idx === heroSlideIndex ? 'true' : 'false'}
                    onClick={() => setHeroSlideIndex(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

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
                    <span
                      className={cn('app-icon app-icon--lg', `app-icon--tone-${app.tone || 'gray'}`)}
                      dangerouslySetInnerHTML={{ __html: getAppIcon(app.iconKey) }}
                    />
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
    // Featured section (recommended apps)
    const renderFeatured = () => {
      if (searchQuery || featuredApps.length === 0) return null;
      return (
        <section className="more-apps-section">
          <div className="app-plaza-recommended">
            <div className="app-plaza-recommended__head">
              <div>
                <h2 className="app-plaza-recommended__title">{t('moreApps.recommended', { defaultValue: '官方推荐' })}</h2>
                <p className="app-plaza-recommended__lead">{t('moreApps.recommendedLead', { defaultValue: '编辑精选 · 高频经营场景 · 一键安装' })}</p>
              </div>
              <button
                type="button"
                className="app-plaza-recommended__more"
                data-tab-jump="market"
                onClick={() => setActiveTab('market')}
              >
                {t('moreApps.viewAll', { defaultValue: '浏览更多' })}
              </button>
            </div>
            <div className="app-plaza-featured__scroll">
              {featuredApps.map((app) => {
                const installed = isAppInstalled(app.id);
                return (
                  <article key={app.id} className="app-plaza-featured__card">
                    <span
                      className={cn('app-icon app-icon--md', `app-icon--tone-${app.tone || 'gray'}`)}
                      dangerouslySetInnerHTML={{ __html: getAppIcon(app.iconKey) }}
                    />
                    <div className="app-plaza-featured__body">
                      {app.badge && <span className="app-plaza-featured__badge">{app.badge}</span>}
                      <h3 className="app-plaza-featured__title">{app.name}</h3>
                      <p className="app-plaza-featured__desc">{app.description}</p>
                      <div className="app-plaza-featured__foot">
                        <span className="app-plaza-featured__status">{t('moreApps.official', { defaultValue: '官方应用' })}</span>
                        <button
                          type="button"
                          className={cn('app-plaza-featured__cta', installed && 'app-plaza-featured__cta--open')}
                          onClick={() => handleOpenApp(app)}
                        >
                          {installed ? t('moreApps.open', { defaultValue: '打开' }) : t('moreApps.install', { defaultValue: '打开' })}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      );
    };

    return (
      <div className="more-apps-main">
        {renderFeatured()}
        
        {/* Grid */}
        {filteredInstalledApps.length > 0 ? (
          <section className="more-apps-section">
            <div className="more-apps-grid">
              {filteredInstalledApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  isMineTab={true}
                  isInstalled={isAppInstalled(app.id)}
                  isFavorite={isAppFavorite(app.id)}
                  onOpen={handleOpenApp}
                  onInstall={installApp}
                  onDelete={app.external ? handleDelete : undefined}
                  onToggleFavorite={!app.external ? handleToggleFavorite : undefined}
                />
              ))}
            </div>
          </section>
        ) : (
          <div className="more-apps-empty">
            {searchQuery
              ? t('moreApps.emptySearch', { defaultValue: '未找到匹配的应用，试试其他关键词' })
              : t('moreApps.emptyInstalled', { defaultValue: '还没有安装应用，去应用市场看看' })}
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
