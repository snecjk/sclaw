import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import categoryOrganization from '@/assets/learning-center/category-organization.png';
import categoryQuotation from '@/assets/learning-center/category-quotation.png';
import categoryReconciliation from '@/assets/learning-center/category-reconciliation.png';
import categoryProfitLoss from '@/assets/learning-center/category-profit-loss.png';
import categoryAdvanced from '@/assets/learning-center/category-advanced.png';
import { FeedbackState } from '@/components/common/FeedbackState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import './LearningCenterPage.css';

const CONTENT_PAGE_SIZE = 6;
const STEP_COUNT_PATTERN = /(\d+\s*步)/;
const CATEGORY_ILLUSTRATIONS = [
  categoryOrganization,
  categoryQuotation,
  categoryReconciliation,
  categoryProfitLoss,
  categoryAdvanced,
];

const CATEGORY_ILLUSTRATION_RULES: Array<{ pattern: RegExp; source: string }> = [
  { pattern: /组织|organization|\borg\b/i, source: categoryOrganization },
  { pattern: /客户报价|报价|quotation|quote/i, source: categoryQuotation },
  { pattern: /对账|reconciliation|reconcile/i, source: categoryReconciliation },
  { pattern: /损益|profit|loss/i, source: categoryProfitLoss },
  { pattern: /对总|进阶|advanced|overall/i, source: categoryAdvanced },
];

function resolveCategoryIllustration(category: LearningCategory, index: number): string {
  const identity = `${category.categoryCode} ${category.name} ${category.title}`;
  return CATEGORY_ILLUSTRATION_RULES.find(({ pattern }) => pattern.test(identity))?.source
    || CATEGORY_ILLUSTRATIONS[index]
    || categoryAdvanced;
}

function renderDomainTitle(title: string) {
  return title.split(STEP_COUNT_PATTERN).map((part, index) => (
    /^\d+\s*步$/.test(part)
      ? <em key={index} className="learning-center-hero__emphasis">{part}</em>
      : part
  ));
}

function categoryIndexLabel(index: number) {
  return String(index + 1).padStart(2, '0');
}

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
  const [tutorialPanelContainer, setTutorialPanelContainer] = useState<HTMLElement | null>(null);
  const [detailCase, setDetailCase] = useState<LearningCaseTemplate | null>(null);
  const [pendingUseCase, setPendingUseCase] = useState<LearningCaseTemplate | null>(null);
  const selectedCategoryRef = useRef<string | null>(null);
  const tutorialTokenRef = useRef(0);
  const caseTokenRef = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseUseInFlightRef = useRef(false);
  const contentRegionRef = useRef<HTMLDivElement | null>(null);
  const pageRootRef = useRef<HTMLElement | null>(null);

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
  const domainTitle = state.status === 'ready'
    ? (state.domain.mainTitle || state.domain.name || t('fallbackTitle'))
    : t('fallbackTitle');
  const tutorialOffset = tutorials.status === 'ready'
    ? (tutorials.pageNum - 1) * tutorials.pageSize
    : 0;
  const visibleTutorialCount = tutorials.status === 'ready'
    ? Math.min(tutorials.items.length, CONTENT_PAGE_SIZE)
    : 0;
  const tutorialSectionHeight = 250 + Math.max(0, visibleTutorialCount - 3) * 52;

  return (
    <>
      <main
        ref={pageRootRef}
        className={`learning-center-page h-full min-h-0 overflow-y-auto bg-background px-4 py-5 sm:px-6 lg:px-8${tutorialId ? ' learning-center-page--detail-open' : ''}`}
      >
        <div className="learning-center-page__inner flex flex-col gap-8">
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
              <section className="learning-center-hero">
                <h1 className="learning-center-hero__title">{renderDomainTitle(domainTitle)}</h1>
                <p className="learning-center-hero__subtitle">{state.domain.subTitle || state.domain.description || t('fallbackSubtitle')}</p>
              </section>

              {state.categories.length === 0 ? (
                <FeedbackState state="empty" title={t('emptyCategoryTitle')} description={t('emptyCategoryDescription')} />
              ) : (
                <section
                  className="learning-center-steps"
                  aria-label={t('categoriesTitle')}
                  style={{ '--lc-steps-height': `${tutorialSectionHeight}px` } as CSSProperties}
                >
                  <Tabs value={state.selectedCategoryId ?? undefined} onValueChange={selectCategory}>
                    <div className="learning-center-steps__scroller">
                      <TabsList
                        aria-label={t('categoriesAria')}
                        className="learning-center-steps__tabs grid h-auto min-h-[3.25rem] rounded-none border-0 p-0 shadow-none"
                        style={{ gridTemplateColumns: `repeat(${state.categories.length}, minmax(7.25rem, 1fr))` }}
                      >
                        {state.categories.map((category, index) => (
                          <TabsTrigger
                            key={category.id}
                            value={category.id}
                            aria-label={category.title || category.name}
                            className="learning-center-steps__tab rounded-none shadow-none"
                          >
                            <span className="learning-center-steps__index" aria-hidden>{categoryIndexLabel(index)}</span>
                            <span className="truncate">{category.title || category.name}</span>
                            {category.id === selectedCategoryId ? (
                              <img
                                src={resolveCategoryIllustration(category, index)}
                                alt=""
                                className="learning-center-steps__art"
                              />
                            ) : null}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                  </Tabs>

                  {selectedCategoryId && (
                    <div
                      ref={contentRegionRef}
                      tabIndex={-1}
                      aria-labelledby="learning-center-content-heading"
                      aria-live="polite"
                      aria-busy={tutorials.status === 'loading'}
                      className="learning-center-steps__panel outline-none"
                    >
                      <h2 id="learning-center-content-heading" className="sr-only">{t('tutorialsTitle')}</h2>
                      {tutorials.status === 'loading' && <FeedbackState state="loading" title={t('tutorialsLoading')} />}
                      {tutorials.status === 'error' && <FeedbackState state="error" title={t('tutorialsErrorTitle')} description={tutorials.message || t('sectionErrorDescription')} action={<Button size="sm" onClick={() => requestTutorialPage(selectedCategoryId, tutorials.pageNum)}>{t('retry')}</Button>} />}
                      {tutorials.status === 'ready' && tutorials.items.length === 0 && <FeedbackState state="empty" title={t('tutorialsEmptyTitle')} description={t('tutorialsEmptyDescription')} />}
                      {tutorials.status === 'ready' && tutorials.items.length > 0 && (
                        <>
                          <ul className="learning-center-tutorial-list" aria-label={t('tutorialsTitle')}>
                            {tutorials.items.slice(0, CONTENT_PAGE_SIZE).map((tutorial, index) => (
                              <li key={tutorial.id} className="learning-center-tutorial-item">
                                <span className="learning-center-tutorial-index" aria-hidden>{tutorialOffset + index + 1}</span>
                                <div className="learning-center-tutorial-copy">
                                  <p className="truncate text-xs font-semibold leading-4" title={tutorial.title || tutorial.name}>{tutorial.title || tutorial.name}</p>
                                  {(tutorial.subTitle || tutorial.description) && <p className="line-clamp-1 text-[0.6875rem] leading-4 text-muted-foreground">{tutorial.subTitle || tutorial.description}</p>}
                                </div>
                                <Button
                                  type="button"
                                  variant="link"
                                  className="learning-center-tutorial-link"
                                  style={{ color: '#FF6700' }}
                                  onClick={(event) => {
                                    detailReturnFocusRef.current = event.currentTarget;
                                    setTutorialPanelContainer(pageRootRef.current?.parentElement?.closest('main') ?? null);
                                    setDetailCase(null);
                                    setPendingUseCase(null);
                                    setTutorialId(tutorial.id);
                                  }}
                                >
                                  {t('viewTutorial')}
                                  <ChevronRight className="h-4 w-4" aria-hidden />
                                </Button>
                              </li>
                            ))}
                          </ul>
                          <LearningResourcePagination pageNum={tutorials.pageNum} pageSize={tutorials.pageSize} total={tutorials.total} previousLabel={t('previousPage')} nextLabel={t('nextPage')} summaryLabel={t('paginationSummary', { page: tutorials.pageNum, total: tutorials.total })} onPageChange={(pageNum) => requestTutorialPage(selectedCategoryId, pageNum)} />
                        </>
                      )}
                    </div>
                  )}
                </section>
              )}

              {selectedCategoryId && (
                <section className="learning-center-cases" aria-labelledby="learning-center-cases-heading" aria-live="polite" aria-busy={cases.status === 'loading'}>
                  <h2 id="learning-center-cases-heading" className="learning-center-cases__title">{t('casesTitle')}</h2>
                  {cases.status === 'loading' && <FeedbackState state="loading" title={t('casesLoading')} />}
                  {cases.status === 'error' && <FeedbackState state="error" title={t('casesErrorTitle')} description={cases.message || t('sectionErrorDescription')} action={<Button size="sm" onClick={() => requestCasePage(selectedCategoryId, cases.pageNum)}>{t('retry')}</Button>} />}
                  {cases.status === 'ready' && cases.items.length === 0 && <FeedbackState state="empty" title={t('casesEmptyTitle')} description={t('casesEmptyDescription')} />}
                  {cases.status === 'ready' && cases.items.length > 0 && (
                    <>
                      <ul className="learning-center-cases__grid" aria-label={t('casesTitle')}>
                        {cases.items.map((item) => (
                          <li key={item.id} className="min-w-0">
                            <LearningCaseCard
                              item={item}
                              onViewDetail={(target, trigger) => {
                                caseReturnFocusRef.current = trigger;
                                setTutorialId(null);
                                setPendingUseCase(null);
                                setDetailCase(target);
                              }}
                              onUse={(target, trigger) => {
                                caseReturnFocusRef.current = trigger;
                                setTutorialId(null);
                                setDetailCase(null);
                                setPendingUseCase(target);
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                      <LearningResourcePagination pageNum={cases.pageNum} pageSize={cases.pageSize} total={cases.total} previousLabel={t('previousPage')} nextLabel={t('nextPage')} summaryLabel={t('paginationSummary', { page: cases.pageNum, total: cases.total })} onPageChange={(pageNum) => requestCasePage(selectedCategoryId, pageNum)} />
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
      <TutorialPanel
        key={tutorialId ?? 'closed'}
        tutorialId={tutorialId}
        portalContainer={tutorialPanelContainer}
        returnFocusRef={detailReturnFocusRef}
        onClose={() => setTutorialId(null)}
      />
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
