/**
 * MoreAppsPage — 应用广场 main page
 * Aligned with the PRD demo (more-apps.js / more-apps.css)
 * 
 * Two views:
 * - Market tab: Hero carousel + category filters + row list
 * - Installed tab: Card grid layout
 */
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Search, Plus, Heart, FolderInput, ChevronDown, FileCode2 } from 'lucide-react';
import './more-apps.css';
import { toast } from 'sonner';
import { useMoreAppsStore } from '@/stores/more-apps';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  stoMainInnerShell,
  stoPageTitleClass,
} from '@/lib/surfaces';
import { AppCard } from './AppCard';
import { DevAppCard } from './DevAppCard';
import { AddExternalAppModal } from './AddExternalAppModal';
import { CreateAppDialog } from './CreateAppDialog';
import { AppTemplateManagerDialog } from './AppTemplateManagerDialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { AppIcon } from './AppIcon';
import type { AppItem, AppPlazaBanner, MarketCategory } from '@/types/more-apps';
import { openInSclawBrowser } from '@/lib/open-sclaw-browser';
import {
  appendSkipLoginReturnUrl,
  fetchAppPlazaSkipLoginLink,
} from '@/lib/app-plaza-api';
import {
  hasStoPolicyAuthInEmbedSession,
  hasTeambitionAuthInEmbedSession,
  isTeambitionAppUrl,
} from '@/lib/embed-site-auth';
import { formatAppBadges } from './format-app-badges';
import { useAppDevCatalogStore } from '@/stores/app-dev-catalog';
import { pickProjectFolder } from '@/lib/session-catalog-api';
import { importUserApp } from '@/lib/app-dev-api';
import { useSessionCatalogStore } from '@/stores/session-catalog';
import { useAppPlazaShellStore } from '@/stores/app-plaza-shell';
import { useAppDevPermission } from '@/hooks/use-app-dev-permission';

const HERO_CAROUSEL_INTERVAL = 5000;
/** 空 systemCode（无法换免登）或 sto-policy 需二次登录确认后再打开 */
const STO_POLICY_SYSTEM_CODE = 'sto-policy';
type DevAppTypeFilter = 'all' | 'site' | 'assets';

export function MoreAppsPage() {
  const { t } = useTranslation('common');
  const {
    activeTab,
    searchQuery,
    marketCategory,
    heroSlideIndex,
    externalApps,
    favoriteIds,
    hydrate,
    banners,
    bannersLoading,
    bannersError,
    categories,
    categoryCounts,
    categoriesLoading,
    categoriesError,
    apps,
    catalogApps,
    marketTotal,
    total,
    loading,
    loadingMore,
    error,
    setActiveTab,
    setSearchQuery,
    setMarketCategory,
    setHeroSlideIndex,
    fetchBanners,
    fetchCategories,
    fetchApps,
    loadMoreApps,
    openAddModal,
    openEditModal,
    removeExternalApp,
    installApp,
    toggleFavorite,
    isAppInstalled,
    isAppFavorite,
  } = useMoreAppsStore();

  const [confirmDeleteApp, setConfirmDeleteApp] = useState<AppItem | null>(null);
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [importingApp, setImportingApp] = useState(false);
  const [pendingStoPolicyApp, setPendingStoPolicyApp] = useState<AppItem | null>(null);
  const [failedBannerImages, setFailedBannerImages] = useState<string[]>([]);
  const [devAppTypeFilter, setDevAppTypeFilter] = useState<DevAppTypeFilter>('all');
  const heroTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Skip the search-debounce effect's first run on mount — the mount effect
  // already fetches the first APP page, so we don't double-fire on initial render.
  const searchMountedRef = useRef(false);

  const devApps = useAppDevCatalogStore((s) => s.apps);
  const refreshDevApps = useAppDevCatalogStore((s) => s.refresh);
  const { canUseAppDev } = useAppDevPermission();

  useEffect(() => {
    if (!canUseAppDev && activeTab === 'dev-apps') {
      setActiveTab('market');
    }
  }, [activeTab, canUseAppDev, setActiveTab]);

  useEffect(() => {
    if (!canUseAppDev) {
      setCreateAppOpen(false);
      return;
    }
    if (activeTab === 'dev-apps' || createAppOpen) {
      void refreshDevApps().catch((error) => {
        toast.error(error instanceof Error ? error.message : '无法同步 STO 应用列表');
      });
    }
  }, [activeTab, canUseAppDev, createAppOpen, refreshDevApps]);

  const filteredDevApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return devApps;
    return devApps.filter(
      (app) =>
        app.name.toLowerCase().includes(q)
        || app.projectType.toLowerCase().includes(q),
    );
  }, [devApps, searchQuery]);

  const visibleDevApps = useMemo(() => {
    if (devAppTypeFilter === 'all') return filteredDevApps;
    return filteredDevApps.filter((app) => (app.pageType ?? 'site') === devAppTypeFilter);
  }, [devAppTypeFilter, filteredDevApps]);

  const handleImportApp = useCallback(async () => {
    if (!canUseAppDev || importingApp) return;
    setImportingApp(true);
    try {
      const picked = await pickProjectFolder();
      if (!picked) return;
      const result = await importUserApp({ appPath: picked });
      useAppDevCatalogStore.getState().registerWorkspaceId(result.workspaceId);
      await useSessionCatalogStore.getState().refreshWorkspaces().catch(() => undefined);
      await useAppDevCatalogStore.getState().refresh().catch(() => undefined);
      useAppPlazaShellStore.getState().openOrFocusDevAppTab(
        result.workspaceId,
        result.workspaceName,
      );
      toast.success(`已导入「${result.workspaceName}」`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingApp(false);
    }
  }, [canUseAppDev, importingApp]);

  // My apps use a stable session catalog so market category/search requests cannot
  // remove favorited apps from the installed view.
  const allApps = useMemo(() => {
    return [...catalogApps, ...externalApps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [catalogApps, externalApps]);

  const isCatalogApp = useCallback((app: AppItem) => {
    return catalogApps.some((candidate) => candidate.id === app.id);
  }, [catalogApps]);

  // Server categories with a fixed "精选" entry first; while loading or on error
  // only "精选" is shown (分类失败时保留精选 — independent degradation).
  const marketCategoryItems = useMemo(() => {
    const featured = {
      id: 'featured' as MarketCategory,
      label: t('moreApps.categoryFeatured', { defaultValue: '精选' }),
      count: marketTotal,
    };
    const serverItems =
      categoriesLoading || categoriesError
        ? []
        : categories
          // 历史误建的「链接器/连接器」APP 分类不再展示；链接器入口已迁至技能广场页签
          .filter((c) => {
            const name = c.name.trim();
            const id = c.id.trim().toLowerCase();
            return !(
              name === '链接器' ||
              name === '连接器' ||
              id === 'connectors' ||
              id === 'connector'
            );
          })
          .map((c) => ({
            id: c.id as MarketCategory,
            label: c.name,
            count: categoryCounts[c.id] ?? 0,
          }));
    return [featured, ...serverItems];
  }, [categories, categoryCounts, categoriesLoading, categoriesError, marketTotal, t]);

  // APP-type Banner targets must resolve exclusively from the server catalog.
  // Do not fall back to built-in/local URLs when the target APP is not loaded.
  const bannerAppLookup = apps;

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

  // Load the three server blocks on mount — each keeps independent loading/error
  // so one failure never blanks the others (Banner / 分类 / APP 经 Main 代理且独立降级).
  useEffect(() => {
    void hydrate();
    void fetchBanners();
    void fetchCategories();
    void fetchApps({ reset: true });
  }, [hydrate, fetchBanners, fetchCategories, fetchApps]);

  // Debounced keyword search — resets to page 1 with the new keyword after input
  // settles. Skips the initial mount run (the mount effect already fetched page 1)
  // and only fires while the market tab is active (installed tab filters locally).
  useEffect(() => {
    if (activeTab !== 'market') return;
    if (!searchMountedRef.current) {
      searchMountedRef.current = true;
      return;
    }
    const handle = window.setTimeout(() => {
      void fetchApps({ reset: true });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchQuery, activeTab, fetchApps]);

  // Keep heroSlideIndex in range when the banner set changes (refetch / shrink).
  useEffect(() => {
    if (banners.length > 0 && heroSlideIndex >= banners.length) {
      setHeroSlideIndex(0);
    }
  }, [banners.length, heroSlideIndex, setHeroSlideIndex]);

  // Hero carousel auto-rotate — 链接器分类下同样保留 Banner 轮播
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

  const openAppWithSkipLogin = useCallback(async (app: AppItem) => {
    // 免登仅针对应用广场目录应用；外部/我的应用自定义项始终直接打开 URL。
    const systemCode = app.systemCode?.trim() || '';
    const hasUrl = !!app.url?.trim();
    const skipLoginEligible = isCatalogApp(app);
    if (!systemCode && !hasUrl) return;

    if (!isAppInstalled(app.id)) {
      installApp(app.id);
    }

    const shouldExchangeSkipLogin =
      skipLoginEligible && !!systemCode && systemCode !== STO_POLICY_SYSTEM_CODE;

    if (shouldExchangeSkipLogin) {
      try {
        const skipLoginUrl = await fetchAppPlazaSkipLoginLink(systemCode);
        const openUrl = appendSkipLoginReturnUrl(skipLoginUrl, app.url);
        openInSclawBrowser({
          url: openUrl,
          title: app.name,
          appId: app.id,
          sourceUrl: app.url,
          systemCode,
          skipLoginEligible,
          iconUrl: app.iconUrl,
          iconKey: app.iconKey,
          tone: app.tone,
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(message || '免登链接获取失败');
        if (!hasUrl) return;
        // Fall back to catalog URL (useStoToken / sto-sso-web injection still applies).
      }
    }

    if (hasUrl) {
      openInSclawBrowser({
        url: app.url,
        title: app.name,
        appId: app.id,
        sourceUrl: app.url,
        systemCode: systemCode || undefined,
        skipLoginEligible,
        iconUrl: app.iconUrl,
        iconKey: app.iconKey,
        tone: app.tone,
      });
    }
  }, [installApp, isAppInstalled, isCatalogApp]);

  const handleOpenApp = useCallback(async (app: AppItem) => {
    const systemCode = app.systemCode?.trim() || '';
    const hasUrl = !!app.url?.trim();
    const skipLoginEligible = isCatalogApp(app);
    if (!systemCode && !hasUrl) return;

    // 只有应用广场目录应用才需要二次登录确认 / 免登判断。
    // sto-policy：有未过期 stoToken/Authorization cookie 则直接打开。
    // Teambition（空 systemCode）：有未过期 TEAMBITION_SESSIONID 则直接打开。
    if (skipLoginEligible && !systemCode) {
      if (isTeambitionAppUrl(app.url)) {
        const authed = await hasTeambitionAuthInEmbedSession();
        if (authed) {
          void openAppWithSkipLogin(app);
          return;
        }
      }
      setPendingStoPolicyApp(app);
      return;
    }
    if (skipLoginEligible && systemCode === STO_POLICY_SYSTEM_CODE) {
      const authed = await hasStoPolicyAuthInEmbedSession();
      if (!authed) {
        setPendingStoPolicyApp(app);
        return;
      }
    }

    void openAppWithSkipLogin(app);
  }, [isCatalogApp, openAppWithSkipLogin]);

  const confirmStoPolicyOpen = useCallback(async () => {
    const app = pendingStoPolicyApp;
    setPendingStoPolicyApp(null);
    if (!app) return;
    await openAppWithSkipLogin(app);
  }, [pendingStoPolicyApp, openAppWithSkipLogin]);

  // Resolve a banner's click target against the currently loaded APP set.
  // APP-type is only clickable when targetAppId resolves to a loaded app's url;
  // never guess a URL when it cannot be resolved (Banner 整图内容 contract).
  const isBannerClickable = useCallback(
    (banner: AppPlazaBanner) => {
      if (banner.targetType === 'URL' && banner.targetUrl) return true;
      if (banner.targetType === 'APP' && banner.targetAppId) {
        return bannerAppLookup.some((a) => {
          if (a.id !== banner.targetAppId) return false;
          return !!a.url?.trim() || !!a.systemCode?.trim();
        });
      }
      return false;
    },
    [bannerAppLookup],
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
        const app = bannerAppLookup.find((a) => a.id === banner.targetAppId);
        if (app && (app.url?.trim() || app.systemCode?.trim())) {
          void handleOpenApp(app);
        }
        // Unresolvable APP target: keep showing the image but do not click — never guess the URL.
      }
      // NONE-type: no target, not clickable.
    },
    [bannerAppLookup, handleOpenApp],
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

  // Selecting a category resets the APP query to page 1. "精选" leaves
  // marketCategory='featured' so the store sends no categoryCode; any server
  // category sends its id as categoryCode (分类导航使用服务端分类).
  const handleSelectCategory = useCallback(
    (id: MarketCategory) => {
      setMarketCategory(id);
      void fetchApps({ reset: true });
    },
    [setMarketCategory, fetchApps],
  );

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

  // ── Market APP list (server catalog) ──────────────────────────
  // Renders server apps with independent loading / error / empty / load-more.
  // No static mock fallback on failure (APP 列表使用服务端目录).
  const renderMarketApps = () => {
    if (loading) {
      return (
        <div
          className="app-market__list-skeleton"
          aria-busy="true"
          aria-label={t('moreApps.appsLoading', { defaultValue: '应用加载中' })}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="app-market__row app-market__row--skeleton" />
          ))}
        </div>
      );
    }
    if (error) {
      return (
        <div className="app-market__list-error" role="alert">
          <span className="app-market__list-error-text">
            {t('moreApps.appsError', { defaultValue: '应用列表加载失败' })}
          </span>
          <button
            type="button"
            className="app-market__list-retry"
            onClick={() => fetchApps({ reset: true })}
          >
            {t('moreApps.retry', { defaultValue: '重试' })}
          </button>
        </div>
      );
    }
    if (apps.length === 0) {
      return (
        <div className="app-market__empty">
          {t('moreApps.emptyMarket', { defaultValue: '未找到匹配的应用，试试其他分类或关键词' })}
        </div>
      );
    }
    const hasMore = apps.length < total;
    return (
      <>
        <div className="app-market__grid">
          {apps.map((app) => {
            const installed = isAppInstalled(app.id);
            const favorite = isAppFavorite(app.id);
            const badgeText = formatAppBadges(app.badge);
            return (
              <article
                key={app.id}
                className={cn('app-market__row', installed && 'app-market__row--installed')}
                data-app-id={app.id}
                role="button"
                tabIndex={0}
                aria-label={t('moreApps.openApp', {
                  appName: app.name,
                  defaultValue: `打开${app.name}`,
                })}
                onClick={() => handleOpenApp(app)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenApp(app);
                  }
                }}
              >
                <div className="app-market__row-main">
                  <AppIcon
                    iconKey={app.iconKey}
                    iconUrl={app.iconUrl}
                    tone={app.tone}
                    size="lg"
                    shape="rounded"
                  />
                  <div className="app-market__row-body">
                    <h4 className="app-market__row-title">{app.name}</h4>
                    <p
                      className="app-market__row-tags"
                      title={badgeText || undefined}
                      aria-hidden={!badgeText}
                    >
                      {badgeText}
                    </p>
                  </div>
                </div>
                {!app.external && (
                  <button
                    type="button"
                    className={cn('app-market__row-favorite', favorite && 'app-market__row-favorite--active')}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleToggleFavorite(app.id);
                    }}
                    aria-label={favorite ? t('moreApps.unfavorite', { defaultValue: '取消收藏' }) : t('moreApps.favorite', { defaultValue: '收藏' })}
                  >
                    <Heart className="h-4 w-4" fill={favorite ? 'currentColor' : 'none'} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
        {hasMore && (
          <div className="app-market__load-more-wrap">
            <button
              type="button"
              className={cn('app-market__load-more', loadingMore && 'app-market__load-more--loading')}
              onClick={() => loadMoreApps()}
              disabled={loadingMore}
            >
              {loadingMore
                ? t('moreApps.loadingMore', { defaultValue: '加载中…' })
                : t('moreApps.loadMore', { defaultValue: '加载更多' })}
            </button>
          </div>
        )}
      </>
    );
  };

  // ── Market Tab View ──────────────────────────────────────────
  const renderMarketView = () => {
    return (
      <>
        {/* Banner carousel (server 整图) */}
        {renderBannerCarousel()}

        {/* Category Filters — server categories with fixed "精选" first */}
        <nav className="app-market__cats" aria-label={t('moreApps.categoriesAria', { defaultValue: '应用分类' })}>
          {marketCategoryItems.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={cn('app-market__cat', marketCategory === cat.id && 'app-market__cat--active')}
              data-market-cat={cat.id}
              aria-pressed={marketCategory === cat.id ? 'true' : 'false'}
              onClick={() => handleSelectCategory(cat.id)}
            >
              <span>{cat.label}</span>
              <span className="app-market__cat-count" aria-hidden="true">
                {cat.count}
              </span>
            </button>
          ))}
        </nav>

        {/* App List — server-driven */}
        {renderMarketApps()}
      </>
    );
  };

  // ── Installed Tab View ───────────────────────────────────────
  const renderInstalledView = () => {
    if (filteredInstalledApps.length === 0) {
      return (
        <div className="more-apps-main">
          <div className="more-apps-empty">
            {searchQuery
              ? t('moreApps.emptySearch', { defaultValue: '未找到匹配的应用，试试其他关键词' })
              : t('moreApps.emptyInstalled', { defaultValue: '还没有收藏或安装应用，去应用广场看看' })}
          </div>
        </div>
      );
    }

    return (
      <div className="more-apps-main">
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
      </div>
    );
  };

  // ── Dev Apps Tab View ────────────────────────────────────────
  const renderDevAppsView = () => {
    const emptyMessage = searchQuery
      ? t('moreApps.emptySearch', { defaultValue: '未找到匹配的应用，试试其他关键词' })
      : devAppTypeFilter === 'site'
        ? '暂无独立站点'
        : devAppTypeFilter === 'assets'
          ? '暂无托管应用'
          : t('moreApps.emptyDevApps', { defaultValue: '还没有开发中的应用，点击右上角「创建应用」或「导入应用」开始' });

    return (
      <div className="more-apps-main">
        <div className="mb-4 flex items-center gap-1" aria-label="开发应用类型筛选">
          {([['all', '全部'], ['site', '独立站点'], ['assets', '托管应用']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={devAppTypeFilter === value}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs transition-colors',
                devAppTypeFilter === value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              onClick={() => setDevAppTypeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {visibleDevApps.length === 0 ? (
          <div className="more-apps-empty">{emptyMessage}</div>
        ) : (
          <div className="more-apps-grid">
            {visibleDevApps.map((app) => (
              <DevAppCard
                key={app.workspaceId || app.applicationId || `${app.name}:${app.appPath}`}
                app={app}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Main Layout ──────────────────────────────────────────────
  return (
    <div className={cn(stoMainInnerShell, 'page-more-apps flex h-full flex-col', activeTab === 'market' && 'page-more-apps--market')}>
      {/* Heading row: title at left, external app action at right */}
      <div className="app-plaza-heading-row">
        <div className="app-plaza-hero">
          <h1 className={cn(stoPageTitleClass, 'app-plaza-hero__title')}>
            {t('moreApps.title', { defaultValue: '应用广场' })}
          </h1>
          <p className="app-plaza-hero__subtitle">
            {t('moreApps.subtitle', { defaultValue: '发现、安装与管理网点经营应用，像应用商店一样即装即用' })}
          </p>
        </div>

        <div className="app-plaza-heading-actions">
          {canUseAppDev ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="more-apps-add-btn more-apps-add-btn--ghost"
                  id="more-apps-create-app-btn"
                  aria-haspopup="menu"
                >
                  <Plus className="more-apps-add-btn__icon" aria-hidden="true" />
                  {importingApp
                    ? t('moreApps.importingApp', { defaultValue: '导入中…' })
                    : t('moreApps.createApp', { defaultValue: '创建应用' })}
                  <ChevronDown className="more-apps-add-btn__chevron" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem
                  id="more-apps-create-app-item"
                  onSelect={() => setCreateAppOpen(true)}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  {t('moreApps.createApp', { defaultValue: '创建应用' })}
                </DropdownMenuItem>
                {canUseAppDev ? (
                  <DropdownMenuItem onSelect={() => setTemplateManagerOpen(true)}>
                    <FileCode2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    管理应用模板
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  id="more-apps-import-app-btn"
                  disabled={importingApp}
                  onSelect={() => void handleImportApp()}
                >
                  <FolderInput className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  {importingApp
                    ? t('moreApps.importingApp', { defaultValue: '导入中…' })
                    : t('moreApps.importApp', { defaultValue: '导入应用' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <button
            type="button"
            className="more-apps-add-btn more-apps-add-btn--ghost"
            id="more-apps-add-external-btn"
            onClick={openAddModal}
          >
            <Plus className="more-apps-add-btn__icon" aria-hidden="true" />
            {t('moreApps.addExternal', { defaultValue: '安装外部应用' })}
          </button>
        </div>
      </div>

      {/* Toolbar row: tabs at left, search at right */}
      <div className="more-apps-toolbar-row">
        <div className="more-apps-tabs" role="tablist" aria-label={t('moreApps.tabAria', { defaultValue: '应用类型' })}>
          {([
            { id: 'market' as const, label: t('moreApps.tabMarket', { defaultValue: '应用广场' }) },
            { id: 'installed' as const, label: t('moreApps.tabInstalled', { defaultValue: '我的应用' }) },
            ...(canUseAppDev
              ? [{ id: 'dev-apps' as const, label: t('moreApps.tabDevApps', { defaultValue: '开发应用' }) }]
              : []),
          ]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn('more-apps-tab', activeTab === tab.id && 'more-apps-tab--active')}
              role="tab"
              data-tab={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-selected={activeTab === tab.id}
            >
              <span className="more-apps-tab__label">{tab.label}</span>
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
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]">
        {activeTab === 'market'
          ? renderMarketView()
          : activeTab === 'dev-apps'
            ? renderDevAppsView()
            : renderInstalledView()}
      </div>

      {/* Modals */}
      <AddExternalAppModal />
      {canUseAppDev ? (
        <CreateAppDialog open={createAppOpen} onClose={() => setCreateAppOpen(false)} />
      ) : null}
      {canUseAppDev ? (
        <AppTemplateManagerDialog
          open={templateManagerOpen}
          onClose={() => setTemplateManagerOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={!!pendingStoPolicyApp}
        title={t('moreApps.stoPolicyLoginTitle', { defaultValue: '需要二次登录' })}
        message={t('moreApps.stoPolicyLoginDesc', {
          defaultValue: '该系统需要二次登录，确认后将继续打开。',
        })}
        confirmLabel={t('common.confirm', { defaultValue: '确定' })}
        cancelLabel={t('common.cancel', { defaultValue: '取消' })}
        onConfirm={confirmStoPolicyOpen}
        onCancel={() => setPendingStoPolicyApp(null)}
      />
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
