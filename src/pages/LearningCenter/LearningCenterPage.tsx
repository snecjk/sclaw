import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { BookOpen, Layers3, RefreshCw, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FeedbackState } from '@/components/common/FeedbackState';
import { useContentHeader } from '@/components/layout/content-header-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dispatchLearningCaseAction } from '@/lib/learning-case-action';
import {
  pageLearningCases,
  pageLearningCategories,
  pageLearningDomains,
  pageLearningTutorials,
  // Not a React hook despite the endpoint name; aliased so lint reads it as a plain request.
  useLearningCase as requestLearningCaseUse,
} from '@/lib/learning-center-api';
import type {
  LearningCaseTemplate,
  LearningCategory,
  LearningDomain,
  LearningPage,
  LearningTutorial,
} from '@/types/learning-center';
import { CaseDetailDialog } from './CaseDetailDialog';
import { LearningCaseCard } from './LearningCaseCard';
import { LearningResourcePagination } from './LearningResourcePagination';
import { TutorialPanel } from './TutorialPanel';

const CONTENT_PAGE_SIZE = 6;

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

type ResourceState<T> =
  | { status: 'idle' }
  | { status: 'loading'; pageNum: number }
  | { status: 'error'; pageNum: number; message: string }
  | ({ status: 'ready' } & LearningPage<T>);

async function loadTutorialPage(
  categoryId: string,
  pageNum: number,
  token: number,
  tokenRef: { current: number },
  setState: Dispatch<SetStateAction<ResourceState<LearningTutorial>>>,
) {
  try {
    const page = await pageLearningTutorials(categoryId, { pageNum, pageSize: CONTENT_PAGE_SIZE });
    if (token === tokenRef.current) setState({ status: 'ready', ...page });
  } catch (error) {
    if (token === tokenRef.current) {
      setState({ status: 'error', pageNum, message: error instanceof Error ? error.message : '' });
    }
  }
}

async function loadCasePage(
  categoryId: string,
  pageNum: number,
  token: number,
  tokenRef: { current: number },
  setState: Dispatch<SetStateAction<ResourceState<LearningCaseTemplate>>>,
) {
  try {
    const page = await pageLearningCases(categoryId, { pageNum, pageSize: CONTENT_PAGE_SIZE });
    if (token === tokenRef.current) setState({ status: 'ready', ...page });
  } catch (error) {
    if (token === tokenRef.current) {
      setState({ status: 'error', pageNum, message: error instanceof Error ? error.message : '' });
    }
  }
}

export function LearningCenterPage() {
  const { t } = useTranslation('learningCenter');
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LearningCenterPageState>({ status: 'loading' });
  const [tutorials, setTutorials] = useState<ResourceState<LearningTutorial>>({ status: 'idle' });
  const [cases, setCases] = useState<ResourceState<LearningCaseTemplate>>({ status: 'idle' });
  const [tutorialId, setTutorialId] = useState<string | null>(null);
  const [detailCase, setDetailCase] = useState<LearningCaseTemplate | null>(null);
  const [pendingUseCase, setPendingUseCase] = useState<LearningCaseTemplate | null>(null);
  const selectedCategoryRef = useRef<string | null>(null);
  const tutorialTokenRef = useRef(0);
  const caseTokenRef = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseUseInFlightRef = useRef(false);
  const contentRegionRef = useRef<HTMLElement | null>(null);

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
        const selectedCategoryId = categories.items[0]?.id ?? null;
        selectedCategoryRef.current = selectedCategoryId;
        setState({ status: 'ready', domain, categories: categories.items, selectedCategoryId });
        if (!selectedCategoryId) return;

        setTutorials({ status: 'loading', pageNum: 1 });
        setCases({ status: 'loading', pageNum: 1 });
        const tutorialToken = ++tutorialTokenRef.current;
        const caseToken = ++caseTokenRef.current;
        void loadTutorialPage(selectedCategoryId, 1, tutorialToken, tutorialTokenRef, setTutorials);
        void loadCasePage(selectedCategoryId, 1, caseToken, caseTokenRef, setCases);
      } catch (error) {
        if (!active) return;
        setState({ status: 'error', message: error instanceof Error ? error.message : t('loadErrorDescription') });
      }
    };

    void load();
    return () => {
      active = false;
      tutorialTokenRef.current += 1;
      caseTokenRef.current += 1;
    };
  }, [reloadKey, t]);

  const requestTutorialPage = (categoryId: string, pageNum: number) => {
    setTutorials({ status: 'loading', pageNum });
    const token = ++tutorialTokenRef.current;
    void loadTutorialPage(categoryId, pageNum, token, tutorialTokenRef, setTutorials);
  };

  const requestCasePage = (categoryId: string, pageNum: number) => {
    setCases({ status: 'loading', pageNum });
    const token = ++caseTokenRef.current;
    void loadCasePage(categoryId, pageNum, token, caseTokenRef, setCases);
  };

  const selectCategory = (selectedCategoryId: string) => {
    if (selectedCategoryRef.current === selectedCategoryId) return;
    selectedCategoryRef.current = selectedCategoryId;
    tutorialTokenRef.current += 1;
    caseTokenRef.current += 1;
    setTutorialId(null);
    setDetailCase(null);
    setPendingUseCase(null);
    detailReturnFocusRef.current = contentRegionRef.current;
    caseReturnFocusRef.current = contentRegionRef.current;
    setState((current) => current.status === 'ready' ? { ...current, selectedCategoryId } : current);
    requestTutorialPage(selectedCategoryId, 1);
    requestCasePage(selectedCategoryId, 1);
  };

  /**
   * Only the server decides the use count, so the list is reconciled from the
   * response before the action is dispatched — a rejected use leaves the list,
   * the route and the composer draft untouched.
   */
  const confirmCaseUse = async (item: LearningCaseTemplate) => {
    if (caseUseInFlightRef.current) return;
    caseUseInFlightRef.current = true;
    try {
      const action = await requestLearningCaseUse(item.id);
      setCases((current) => current.status === 'ready'
        ? {
          ...current,
          items: current.items.map((entry) => entry.id === item.id
            ? { ...entry, useCount: action.useCount }
            : entry),
        }
        : current);
      setPendingUseCase(null);

      const result = dispatchLearningCaseAction(action, { navigate });
      if (result.ok) {
        toast.success(t('caseUseSuccess'));
      } else {
        toast.error(t(`caseActionError.${result.reason}`));
      }
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t('caseDetailErrorDescription'));
    } finally {
      caseUseInFlightRef.current = false;
    }
  };

  const retryButton = (
    <Button size="sm" onClick={() => {
      setState({ status: 'loading' });
      setTutorials({ status: 'idle' });
      setCases({ status: 'idle' });
      setReloadKey((value) => value + 1);
    }}>
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
      {t('retry')}
    </Button>
  );

  const selectedCategoryId = state.status === 'ready' ? state.selectedCategoryId : null;

  return (
    <>
      <main className={`h-full min-h-0 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:px-8 ${tutorialId ? 'lg:pr-[580px]' : ''}`}>
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
          {state.status === 'loading' && (
            <Card aria-busy="true"><FeedbackState state="loading" title={t('loadingTitle')} description={t('loadingDescription')} /></Card>
          )}
          {state.status === 'error' && (
            <Card role="alert"><FeedbackState state="error" title={t('loadErrorTitle')} description={state.message || t('loadErrorDescription')} action={retryButton} /></Card>
          )}
          {state.status === 'empty' && (
            <Card><FeedbackState state="empty" title={t('emptyDomainTitle')} description={t('emptyDomainDescription')} action={retryButton} /></Card>
          )}

          {state.status === 'ready' && (
            <>
              <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-primary/5 px-5 py-6 shadow-sm sm:px-8 sm:py-8">
                <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-primary/10 bg-primary/5" aria-hidden />
                <div className="relative flex min-w-0 items-center justify-between gap-6">
                  <div className="min-w-0 max-w-3xl">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-card/80 px-3 py-1 text-xs font-medium text-primary">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden />{t('eyebrow')}
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{state.domain.mainTitle || state.domain.name || t('fallbackTitle')}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{state.domain.subTitle || state.domain.description || t('fallbackSubtitle')}</p>
                  </div>
                  {state.domain.coverImageUrl && <img src={state.domain.coverImageUrl} alt="" className="hidden h-24 w-36 shrink-0 rounded-xl border border-primary/15 object-cover shadow-sm md:block" />}
                </div>
              </section>

              <Card>
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Layers3 className="h-5 w-5" aria-hidden /></div>
                    <div><CardTitle className="text-base">{t('categoriesTitle')}</CardTitle><CardDescription>{state.domain.description || t('contentDescription')}</CardDescription></div>
                  </div>
                </CardHeader>
                <CardContent>
                  {state.categories.length === 0 ? (
                    <FeedbackState state="empty" title={t('emptyCategoryTitle')} description={t('emptyCategoryDescription')} />
                  ) : (
                    <Tabs value={state.selectedCategoryId ?? undefined} onValueChange={selectCategory}>
                      <TabsList aria-label={t('categoriesAria')} className="h-auto max-w-full justify-start overflow-x-auto bg-muted/60 p-1.5">
                        {state.categories.map((category) => (
                          <TabsTrigger key={category.id} value={category.id} className="min-h-9 px-4">{category.title || category.name}</TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  )}
                </CardContent>
              </Card>

              {selectedCategoryId && (
                <section ref={contentRegionRef} tabIndex={-1} aria-labelledby="learning-center-content-heading" className="outline-none">
                  <div className="mb-3">
                    <h2 id="learning-center-content-heading" className="text-lg font-semibold">{t('contentTitle')}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t('contentDescription')}</p>
                  </div>
                  <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                    <Card className="min-w-0">
                      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><BookOpen className="h-4 w-4 text-primary" aria-hidden />{t('tutorialsTitle')}</CardTitle></CardHeader>
                      <CardContent aria-live="polite" aria-busy={tutorials.status === 'loading'}>
                        {tutorials.status === 'loading' && <FeedbackState state="loading" title={t('tutorialsLoading')} />}
                        {tutorials.status === 'error' && <FeedbackState state="error" title={t('tutorialsErrorTitle')} description={tutorials.message || t('sectionErrorDescription')} action={<Button size="sm" onClick={() => requestTutorialPage(selectedCategoryId, tutorials.pageNum)}>{t('retry')}</Button>} />}
                        {tutorials.status === 'ready' && tutorials.items.length === 0 && <FeedbackState state="empty" title={t('tutorialsEmptyTitle')} description={t('tutorialsEmptyDescription')} />}
                        {tutorials.status === 'ready' && tutorials.items.length > 0 && (
                          <>
                            <ul className="divide-y" aria-label={t('tutorialsTitle')}>
                              {tutorials.items.map((tutorial) => (
                                <li key={tutorial.id} className="flex min-w-0 items-start justify-between gap-3 py-4 first:pt-1 last:pb-1">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium" title={tutorial.title || tutorial.name}>{tutorial.title || tutorial.name}</p>
                                    {(tutorial.subTitle || tutorial.description) && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tutorial.subTitle || tutorial.description}</p>}
                                  </div>
                                  <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={(event) => {
                                    detailReturnFocusRef.current = event.currentTarget;
                                    setTutorialId(tutorial.id);
                                  }}>{t('viewTutorial')}</Button>
                                </li>
                              ))}
                            </ul>
                            <LearningResourcePagination pageNum={tutorials.pageNum} pageSize={tutorials.pageSize} total={tutorials.total} previousLabel={t('previousPage')} nextLabel={t('nextPage')} summaryLabel={t('paginationSummary', { page: tutorials.pageNum, total: tutorials.total })} onPageChange={(pageNum) => requestTutorialPage(selectedCategoryId, pageNum)} />
                          </>
                        )}
                      </CardContent>
                    </Card>

                    <Card className="min-w-0">
                      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" aria-hidden />{t('casesTitle')}</CardTitle></CardHeader>
                      <CardContent aria-live="polite" aria-busy={cases.status === 'loading'}>
                        {cases.status === 'loading' && <FeedbackState state="loading" title={t('casesLoading')} />}
                        {cases.status === 'error' && <FeedbackState state="error" title={t('casesErrorTitle')} description={cases.message || t('sectionErrorDescription')} action={<Button size="sm" onClick={() => requestCasePage(selectedCategoryId, cases.pageNum)}>{t('retry')}</Button>} />}
                        {cases.status === 'ready' && cases.items.length === 0 && <FeedbackState state="empty" title={t('casesEmptyTitle')} description={t('casesEmptyDescription')} />}
                        {cases.status === 'ready' && cases.items.length > 0 && (
                          <>
                            <ul className="grid min-w-0 gap-4 pt-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" aria-label={t('casesTitle')}>
                              {cases.items.map((item) => (
                                <li key={item.id} className="min-w-0">
                                  <LearningCaseCard
                                    item={item}
                                    onViewDetail={(target, trigger) => {
                                      caseReturnFocusRef.current = trigger;
                                      setDetailCase(target);
                                    }}
                                    onUse={(target, trigger) => {
                                      caseReturnFocusRef.current = trigger;
                                      setPendingUseCase(target);
                                    }}
                                  />
                                </li>
                              ))}
                            </ul>
                            <LearningResourcePagination pageNum={cases.pageNum} pageSize={cases.pageSize} total={cases.total} previousLabel={t('previousPage')} nextLabel={t('nextPage')} summaryLabel={t('paginationSummary', { page: cases.pageNum, total: cases.total })} onPageChange={(pageNum) => requestCasePage(selectedCategoryId, pageNum)} />
                          </>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
      <TutorialPanel key={tutorialId ?? 'closed'} tutorialId={tutorialId} returnFocusRef={detailReturnFocusRef} onClose={() => setTutorialId(null)} />
      <CaseDetailDialog
        key={detailCase?.id ?? 'case-detail-closed'}
        caseId={detailCase?.id ?? null}
        fallbackTitle={detailCase ? (detailCase.title || detailCase.name) : ''}
        returnFocusRef={caseReturnFocusRef}
        onClose={() => setDetailCase(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingUseCase)}
        title={t('caseUseConfirmTitle')}
        message={t('caseUseConfirmMessage', { title: pendingUseCase ? (pendingUseCase.title || pendingUseCase.name) : '' })}
        confirmLabel={pendingUseCase?.actionText || t('caseUseAction')}
        confirmingLabel={t('caseUseConfirming')}
        cancelLabel={t('cancel')}
        onConfirm={() => pendingUseCase ? confirmCaseUse(pendingUseCase) : undefined}
        onCancel={() => {
          if (caseUseInFlightRef.current) return;
          setPendingUseCase(null);
          caseReturnFocusRef.current?.focus();
        }}
      />
    </>
  );
}
