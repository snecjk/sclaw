import { useEffect, useState } from 'react';
import { BookOpen, Layers3, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { useContentHeader } from '@/components/layout/content-header-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { pageLearningCategories, pageLearningDomains } from '@/lib/learning-center-api';
import type { LearningCategory, LearningDomain } from '@/types/learning-center';

type LearningCenterPageState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | {
    status: 'ready';
    domain: LearningDomain;
    categories: LearningCategory[];
    selectedCategoryId: string | null;
  };

export function LearningCenterPage() {
  const { t } = useTranslation('learningCenter');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LearningCenterPageState>({ status: 'loading' });

  useContentHeader({ title: t('pageTitle') });

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const domains = await pageLearningDomains({ pageNum: 1, pageSize: 20 });
        if (!active) return;
        const domain = domains.items[0];
        if (!domain) {
          setState({ status: 'empty' });
          return;
        }

        const categories = await pageLearningCategories(domain.id, { pageNum: 1, pageSize: 100 });
        if (!active) return;
        setState({
          status: 'ready',
          domain,
          categories: categories.items,
          selectedCategoryId: categories.items[0]?.id ?? null,
        });
      } catch (error) {
        if (!active) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : t('loadErrorDescription'),
        });
      }
    };

    void load();
    return () => { active = false; };
  }, [reloadKey, t]);

  const retryButton = (
    <Button size="sm" onClick={() => {
      setState({ status: 'loading' });
      setReloadKey((value) => value + 1);
    }}>
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
      {t('retry')}
    </Button>
  );

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        {state.status === 'loading' && (
          <Card aria-busy="true">
            <FeedbackState state="loading" title={t('loadingTitle')} description={t('loadingDescription')} />
          </Card>
        )}

        {state.status === 'error' && (
          <Card role="alert">
            <FeedbackState
              state="error"
              title={t('loadErrorTitle')}
              description={state.message || t('loadErrorDescription')}
              action={retryButton}
            />
          </Card>
        )}

        {state.status === 'empty' && (
          <Card>
            <FeedbackState state="empty" title={t('emptyDomainTitle')} description={t('emptyDomainDescription')} action={retryButton} />
          </Card>
        )}

        {state.status === 'ready' && (
          <>
            <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-primary/5 px-5 py-6 shadow-sm sm:px-8 sm:py-8">
              <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-primary/10 bg-primary/5" aria-hidden />
              <div className="relative flex min-w-0 items-center justify-between gap-6">
                <div className="min-w-0 max-w-3xl">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-card/80 px-3 py-1 text-xs font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    {t('eyebrow')}
                  </div>
                  <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                    {state.domain.mainTitle || state.domain.name || t('fallbackTitle')}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    {state.domain.subTitle || state.domain.description || t('fallbackSubtitle')}
                  </p>
                </div>
                {state.domain.coverImageUrl && (
                  <img
                    src={state.domain.coverImageUrl}
                    alt=""
                    className="hidden h-24 w-36 shrink-0 rounded-xl border border-primary/15 object-cover shadow-sm md:block"
                  />
                )}
              </div>
            </section>

            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Layers3 className="h-5 w-5" aria-hidden />
                  </div>
                  <div>
                    <CardTitle className="text-base">{t('categoriesTitle')}</CardTitle>
                    <CardDescription>{state.domain.description || t('contentDescription')}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {state.categories.length === 0 ? (
                  <FeedbackState state="empty" title={t('emptyCategoryTitle')} description={t('emptyCategoryDescription')} />
                ) : (
                  <Tabs
                    value={state.selectedCategoryId ?? undefined}
                    onValueChange={(selectedCategoryId) => setState((current) => current.status === 'ready'
                      ? { ...current, selectedCategoryId }
                      : current)}
                  >
                    <TabsList aria-label={t('categoriesAria')} className="h-auto max-w-full justify-start overflow-x-auto bg-muted/60 p-1.5">
                      {state.categories.map((category) => (
                        <TabsTrigger key={category.id} value={category.id} className="min-h-9 px-4">
                          {category.title || category.name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}
              </CardContent>
            </Card>

            {state.selectedCategoryId && (
              <section aria-labelledby="learning-center-content-heading">
                <div className="mb-3">
                  <h2 id="learning-center-content-heading" className="text-lg font-semibold">{t('contentTitle')}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t('contentDescription')}</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[{ key: 'tutorialsTitle', icon: BookOpen }, { key: 'casesTitle', icon: Sparkles }].map(({ key, icon: Icon }) => {
                    const selected = state.categories.find((category) => category.id === state.selectedCategoryId);
                    return (
                      <Card key={key}>
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Icon className="h-4 w-4 text-primary" aria-hidden />
                            {t(key)}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <FeedbackState
                            state="empty"
                            title={t('categoryContentPending', { category: selected?.title || selected?.name || '' })}
                            description={t('categoryContentPendingDescription')}
                          />
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
