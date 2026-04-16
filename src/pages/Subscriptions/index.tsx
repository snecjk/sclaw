/**
 * Subscriptions Page
 * Browse and subscribe to platform features
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Search,
  Bookmark,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSubscriptionsStore } from '@/stores/subscriptions';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { glassSectionSurface, glassNestedCard } from '@/lib/surfaces';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { SubscriptionFeature, FeatureCategory } from '@/types/subscription';

const ALL_CATEGORIES: FeatureCategory[] = [
  'ai-enhanced',
  'data-analysis',
  'efficiency-tools',
  'communication',
  'security',
  'automation',
];

interface FeatureDetailSheetProps {
  feature: SubscriptionFeature | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (featureId: string, subscribe: boolean) => void;
  toggling: Record<string, boolean>;
}

function FeatureDetailSheet({ feature, isOpen, onClose, onToggle, toggling }: FeatureDetailSheetProps) {
  const { t } = useTranslation('subscriptions');

  if (!feature) return null;

  const isSubscribed = feature.status === 'subscribed';
  const isBusy = !!toggling[feature.id];

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-glass-border glass-panel shadow-glass"
        side="right"
      >
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-white dark:bg-accent border border-black/5 dark:border-white/5 shrink-0 mb-4 shadow-sm">
              <span className="text-3xl">{feature.icon}</span>
            </div>
            <h2 className="text-[28px] font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {feature.name}
            </h2>
            <Badge
              variant={isSubscribed ? 'success' : 'secondary'}
              className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full"
            >
              {isSubscribed ? t('status.subscribed') : t('status.unsubscribed')}
            </Badge>
          </div>

          <div className="space-y-7 px-1">
            {/* Description */}
            <div className="space-y-2">
              <p className="text-[14px] text-foreground/70 font-medium leading-[1.6] text-center px-4">
                {feature.description}
              </p>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <h3 className="text-[13px] font-bold text-foreground/80">{t('detail.tags')}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {feature.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="font-mono text-[11px] font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors"
                  >
                    {t(`filter.${tag}`)}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Last updated */}
            {feature.updatedAt && (
              <div className="space-y-2">
                <h3 className="text-[13px] font-bold text-foreground/80">{t('detail.lastUpdated')}</h3>
                <p className="text-[13px] text-foreground/60 font-mono">
                  {new Date(feature.updatedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="pt-8 pb-4 flex items-center justify-center w-full px-2 max-w-[340px] mx-auto">
            <Button
              onClick={() => onToggle(feature.id, !isSubscribed)}
              disabled={isBusy}
              className={cn(
                'w-full h-[42px] text-[13px] rounded-full font-semibold shadow-sm border border-transparent transition-all',
                isSubscribed
                  ? 'bg-transparent border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 text-foreground/80 hover:text-foreground'
                  : 'bg-[#0a84ff] hover:bg-[#007aff] text-white',
              )}
              variant={isSubscribed ? 'outline' : 'default'}
            >
              {isBusy
                ? t('actions.subscribing')
                : isSubscribed
                  ? t('actions.unsubscribe')
                  : t('actions.subscribe')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Subscriptions() {
  const {
    features,
    loading,
    toggling,
    fetchFeatures,
    subscribe,
    unsubscribe,
  } = useSubscriptionsStore();
  const { t } = useTranslation('subscriptions');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | FeatureCategory>('all');
  const [selectedFeature, setSelectedFeature] = useState<SubscriptionFeature | null>(null);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const handleToggle = useCallback(async (featureId: string, shouldSubscribe: boolean) => {
    try {
      if (shouldSubscribe) {
        await subscribe(featureId);
        toast.success(t('toast.subscribed'));
      } else {
        await unsubscribe(featureId);
        toast.success(t('toast.unsubscribed'));
      }
      // Update selected feature if it's the one being toggled
      setSelectedFeature((prev) => {
        if (!prev || prev.id !== featureId) return prev;
        return { ...prev, status: shouldSubscribe ? 'subscribed' : 'unsubscribed' };
      });
    } catch {
      toast.error(t('toast.error'));
    }
  }, [subscribe, unsubscribe, t]);

  const safeFeatures = Array.isArray(features) ? features : [];

  const filteredFeatures = safeFeatures.filter((feature) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      q.length === 0 ||
      feature.name.toLowerCase().includes(q) ||
      feature.description.toLowerCase().includes(q);

    const matchesCategory =
      selectedCategory === 'all' || feature.tags.includes(selectedCategory);

    return matchesSearch && matchesCategory;
  }).sort((a, b) => {
    // Subscribed first, then by name
    if (a.status === 'subscribed' && b.status !== 'subscribed') return -1;
    if (a.status !== 'subscribed' && b.status === 'subscribed') return 1;
    return a.name.localeCompare(b.name);
  });

  const categoryStats = {
    all: safeFeatures.length,
    ...Object.fromEntries(
      ALL_CATEGORIES.map((cat) => [
        cat,
        safeFeatures.filter((f) => f.tags.includes(cat)).length,
      ]),
    ),
  } as Record<'all' | FeatureCategory, number>;

  if (loading && safeFeatures.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col pb-10">
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 pb-10">
      {/* Header */}
      <header className="shrink-0 border-b border-primary/10 pb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-primary/[0.08] text-primary shadow-[0_8px_24px_rgba(56,189,248,0.12)]">
              <Bookmark className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.65rem]">
                {t('title')}
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6">
        <section className={glassSectionSurface}>
          {/* Category tab bar */}
          <div className="-mx-6 -mt-6 mb-6 flex items-stretch border-b border-primary/10 px-2 pt-1">
            {([
              { key: 'all' as const, label: t('filter.all', { count: categoryStats.all }) },
              ...ALL_CATEGORIES.map((cat) => ({
                key: cat,
                label: `${t(`filter.${cat}`)} (${categoryStats[cat]})`,
              })),
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedCategory(key)}
                className={cn(
                  'relative -mb-px border-b-2 border-transparent px-5 py-3 text-[13px] font-medium transition-colors whitespace-nowrap',
                  selectedCategory === key
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground/60 hover:text-foreground/80',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search + refresh bar */}
          <div className="flex flex-col gap-4 border-b border-primary/10 pb-4 mb-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center flex-wrap gap-4 text-[14px]">
              <div className="group relative mr-2 flex items-center rounded-md border border-transparent bg-black/5 px-3 py-1.5 transition-colors focus-within:border-primary/15 focus-within:bg-[hsl(var(--glass-bg)/0.25)] dark:bg-white/5 dark:focus-within:bg-white/10">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  placeholder={t('search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-[13px] text-foreground"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="icon"
                onClick={fetchFeatures}
                className="ml-1 h-8 w-8 rounded-md border-glass-border bg-transparent text-muted-foreground shadow-none hover:bg-[hsl(var(--glass-bg)/0.35)] hover:text-foreground"
                title={t('refresh')}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {/* Feature list */}
          <div className="pb-2">
            {filteredFeatures.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Bookmark className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noResults') : t('empty')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-1">
                {filteredFeatures.map((feature) => {
                  const isSubscribed = feature.status === 'subscribed';
                  const isBusy = !!toggling[feature.id];
                  return (
                    <div
                      key={feature.id}
                      className={cn(
                        'group flex flex-col cursor-pointer rounded-md border border-primary/10 p-4 transition-all duration-200 hover:border-primary/18 hover:shadow-md',
                        glassNestedCard,
                      )}
                      onClick={() => setSelectedFeature(feature)}
                    >
                      {/* Top: icon + name */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="h-12 w-12 shrink-0 flex items-center justify-center text-2xl rounded-full glass border shadow-sm">
                          {feature.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-[15px] font-semibold text-foreground truncate">{feature.name}</h3>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {feature.tags.slice(0, 2).map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="px-1.5 py-0 h-5 text-[10px] font-medium bg-black/5 dark:bg-white/10 border-0 shadow-none"
                              >
                                {t(`filter.${tag}`)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-[13px] text-muted-foreground line-clamp-2 mb-3 flex-1 leading-relaxed">
                        {feature.description}
                      </p>

                      {/* Bottom: status + button */}
                      <div
                        className="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge
                          variant={isSubscribed ? 'success' : 'secondary'}
                          className="text-[10px] px-2 py-0 h-5"
                        >
                          {isSubscribed ? t('status.subscribed') : t('status.unsubscribed')}
                        </Badge>
                        <Button
                          variant={isSubscribed ? 'outline' : 'default'}
                          size="sm"
                          disabled={isBusy}
                          onClick={() => handleToggle(feature.id, !isSubscribed)}
                          className={cn(
                            'h-7 px-3 rounded-full shadow-none font-medium text-[11px]',
                            isSubscribed && 'border-glass-border bg-transparent hover:bg-[hsl(var(--glass-bg)/0.35)]',
                          )}
                        >
                          {isBusy
                            ? t('actions.subscribing')
                            : isSubscribed
                              ? t('actions.unsubscribe')
                              : t('actions.subscribe')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Feature Detail Sheet */}
      <FeatureDetailSheet
        feature={selectedFeature}
        isOpen={!!selectedFeature}
        onClose={() => setSelectedFeature(null)}
        onToggle={handleToggle}
        toggling={toggling}
      />
    </div>
  );
}

export default Subscriptions;
