import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';
import { ChevronRight, PanelRightClose, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import categoryOrganizationCard from '@/assets/learning-center/category-organization-card.svg';
import categoryQuotationCard from '@/assets/learning-center/category-quotation-card.svg';
import categoryReconciliationCard from '@/assets/learning-center/category-reconciliation-card.svg';
import categoryProfitLossCard from '@/assets/learning-center/category-profit-loss-card.svg';
import categoryAdvancedCard from '@/assets/learning-center/category-advanced-card.svg';
import sectionEmptyIcon from '@/assets/learning-center/case-empty-icon.svg';
import titleStepUnderline from '@/assets/learning-center/title-step-underline.svg';
import { FeedbackState } from '@/components/common/FeedbackState';
import { useContentHeader } from '@/components/layout/content-header-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { invokeIpc } from '@/lib/api-client';
import { dispatchLearningCaseAction } from '@/lib/learning-case-action';
import { resolveLearningCaseChipTitle } from '@/lib/learning-case-chip-title';
import { contentHeaderActionBtnClass } from '@/lib/surfaces';
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
import { CaseCoverPreviewDialog } from './CaseCoverPreviewDialog';
import { CaseDetailDialog } from './CaseDetailDialog';
import { LearningCaseCard } from './LearningCaseCard';
import { LearningResourcePagination } from './LearningResourcePagination';
import { TutorialPanel } from './TutorialPanel';
import './LearningCenterPage.css';

const CONTENT_PAGE_SIZE = 6;
const WINDOW_DEFAULT_MIN_WIDTH = 960;
const WINDOW_DEFAULT_MIN_HEIGHT = 640;
const DETAIL_LEFT_MIN_WIDTH = 563;

function syncTutorialWindowMinSize(page: HTMLElement | null, detailOpen: boolean) {
  if (!detailOpen || !page || window.innerWidth < 1024) {
    void invokeIpc('window:setMinimumSize', {
      width: WINDOW_DEFAULT_MIN_WIDTH,
      height: WINDOW_DEFAULT_MIN_HEIGHT,
    }).catch(() => undefined);
    return;
  }

  const leftWidth = page.getBoundingClientRect().width;
  const minWidth = Math.max(
    WINDOW_DEFAULT_MIN_WIDTH,
    Math.round(window.outerWidth + (DETAIL_LEFT_MIN_WIDTH - leftWidth)),
  );
  void invokeIpc('window:setMinimumSize', {
    width: minWidth,
    height: WINDOW_DEFAULT_MIN_HEIGHT,
  }).catch(() => undefined);
}

const STEP_COUNT_PATTERN = /(\d+)\s*步/;
type CategoryArt = {
  source: string;
  composed?: boolean;
  rotate: number;
  cardX: number;
  cardY: number;
};

/* MasterGo 容器 7964 / 组 7896: 140x140, inner card 106x120. */
const CATEGORY_ART_DEFAULTS: CategoryArt[] = [
  { source: categoryOrganizationCard, composed: true, rotate: 0, cardX: 0, cardY: 0 },
  { source: categoryQuotationCard, composed: true, rotate: 0, cardX: 0, cardY: 0 },
  { source: categoryReconciliationCard, composed: true, rotate: 0, cardX: 0, cardY: 0 },
  { source: categoryProfitLossCard, composed: true, rotate: 0, cardX: 0, cardY: 0 },
  { source: categoryAdvancedCard, composed: true, rotate: 0, cardX: 0, cardY: 0 },
];

const CATEGORY_ILLUSTRATION_RULES: Array<{ pattern: RegExp; art: CategoryArt }> = [
  { pattern: /组织|organization|\borg\b/i, art: CATEGORY_ART_DEFAULTS[0] },
  { pattern: /客户报价|报价|quotation|quote/i, art: CATEGORY_ART_DEFAULTS[1] },
  { pattern: /对账|reconciliation|reconcile/i, art: CATEGORY_ART_DEFAULTS[2] },
  { pattern: /损益|profit|loss/i, art: CATEGORY_ART_DEFAULTS[3] },
  { pattern: /对总|进阶|advanced|overall/i, art: CATEGORY_ART_DEFAULTS[4] },
];

function resolveCategoryArt(category: LearningCategory, index: number): CategoryArt {
  const identity = `${category.categoryCode} ${category.name} ${category.title}`;
  return CATEGORY_ILLUSTRATION_RULES.find(({ pattern }) => pattern.test(identity))?.art
    || CATEGORY_ART_DEFAULTS[index]
    || CATEGORY_ART_DEFAULTS[4];
}

function readCssLengthPx(element: HTMLElement, variableName: string): number {
  const raw = getComputedStyle(element).getPropertyValue(variableName).trim();
  if (!raw) {
    return 0;
  }
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = raw;
  element.appendChild(probe);
  const pixels = probe.offsetWidth;
  probe.remove();
  return pixels;
}

function parseDomainTitle(title: string) {
  const match = title.match(STEP_COUNT_PATTERN);
  if (!match || match.index === undefined) {
    return null;
  }
  return {
    leading: title.slice(0, match.index).trimEnd(),
    trailing: title.slice(match.index + match[0].length).trimStart(),
  };
}

function renderDomainTitle(title: string, stepCount: number, fallbackSuffix: string, stepLabel: string) {
  if (stepCount < 1) {
    return title;
  }
  const parts = parseDomainTitle(title);
  const leading = (parts?.leading || title).trim();
  const trailing = (parts?.trailing || fallbackSuffix).trim();
  return (
    <>
      {leading}
      <span className="learning-center-hero__steps">
        <em className="learning-center-hero__step-count">{stepCount}</em>
        <em className="learning-center-hero__step-label">{stepLabel}</em>
        <img src={titleStepUnderline} alt="" aria-hidden className="learning-center-hero__step-underline" width={50} height={15} />
      </span>
      {trailing}
    </>
  );
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
    categoryTotal: number;
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
  const [previewCase, setPreviewCase] = useState<LearningCaseTemplate | null>(null);
  const selectedCategoryRef = useRef<string | null>(null);
  const tutorialTokenRef = useRef(0);
  const caseTokenRef = useRef(0);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseReturnFocusRef = useRef<HTMLElement | null>(null);
  const caseUseInFlightRef = useRef(false);
  const contentRegionRef = useRef<HTMLDivElement | null>(null);
  const pageRootRef = useRef<HTMLElement | null>(null);
  const tutorialSlotRef = useRef<HTMLDivElement | null>(null);
  const stepsRef = useRef<HTMLElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  const closeTutorial = useCallback(() => setTutorialId(null), []);

  useLayoutEffect(() => {
    setTutorialPanelContainer(tutorialSlotRef.current);
  }, []);

  useEffect(() => {
    const page = pageRootRef.current;
    const detailOpen = Boolean(tutorialId);
    syncTutorialWindowMinSize(page, detailOpen);

    if (!detailOpen || !page) {
      return () => {
        syncTutorialWindowMinSize(null, false);
      };
    }

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        syncTutorialWindowMinSize(page, true);
      });
    observer?.observe(page);
    const onResize = () => syncTutorialWindowMinSize(page, true);
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      syncTutorialWindowMinSize(null, false);
    };
  }, [tutorialId]);

  useLayoutEffect(() => {
    if (!tutorialId) return;
    const workspaceMain = pageRootRef.current?.parentElement?.closest('main');
    if (!workspaceMain) return;
    const previousWidth = workspaceMain.style.getPropertyValue('--sto-split-preview-col');
    workspaceMain.style.setProperty('--sto-split-preview-col', '35.25rem');
    return () => {
      if (previousWidth) {
        workspaceMain.style.setProperty('--sto-split-preview-col', previousWidth);
      } else {
        workspaceMain.style.removeProperty('--sto-split-preview-col');
      }
    };
  }, [tutorialId]);

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
        setState({
          status: 'ready',
          domain,
          categories: categories.items,
          categoryTotal: categories.total,
          selectedCategoryId,
        });
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
    setPreviewCase(null);
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
      const result = dispatchLearningCaseAction(action, {
        navigate,
        displayTitle: await resolveLearningCaseChipTitle(action),
      });
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
  const titleStepCount = state.status === 'ready'
    ? Math.max(state.categoryTotal - 1, 0)
    : 0;
  const visibleTutorialCount = tutorials.status === 'ready'
    ? Math.min(tutorials.items.length, CONTENT_PAGE_SIZE)
    : 0;
  // Design row: 40px item + 12px gap; panel padding 18*2.
  // ≤3 rows keep a fixed visual height; 4-6 grow to fit; never taller than content.
  const tutorialRowCount = Math.min(Math.max(visibleTutorialCount, 3), CONTENT_PAGE_SIZE);
  const tutorialPanelHeight = 36 + tutorialRowCount * 40 + Math.max(0, tutorialRowCount - 1) * 12;
  const tutorialSectionHeight = 54 + tutorialPanelHeight + 4;

  const selectedCategoryIndex = state.status === 'ready' && selectedCategoryId
    ? state.categories.findIndex((category) => category.id === selectedCategoryId)
    : -1;
  const activeCategoryArt = selectedCategoryIndex >= 0 && state.status === 'ready'
    ? resolveCategoryArt(state.categories[selectedCategoryIndex], selectedCategoryIndex)
    : null;

  useLayoutEffect(() => {
    const steps = stepsRef.current;
    const tab = activeTabRef.current;
    if (!steps || !tab || !activeCategoryArt) {
      return;
    }

    const updateArtPlacement = () => {
      const stepsRect = steps.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      const label = tab.querySelector<HTMLElement>('.learning-center-steps__tab-label');
      const labelRect = label?.getBoundingClientRect();
      const artSize = readCssLengthPx(steps, '--lc-step-art-size');
      if (!artSize) {
        return;
      }

      const labelRight = labelRect
        ? labelRect.right - stepsRect.left
        : tabRect.left - stepsRect.left + 12;
      const gap = readCssLengthPx(steps, '--lc-tab-art-gap') || 8;
      const trail = readCssLengthPx(steps, '--lc-tab-art-trail') || 4;
      const tabLeft = tabRect.left - stepsRect.left;
      const activeMin = Math.ceil(labelRight + gap + artSize + trail - tabLeft);
      steps.style.setProperty('--lc-tab-active-min', `${Math.max(activeMin, 0)}px`);

      const nextTabRect = tab.getBoundingClientRect();
      const tabRight = nextTabRect.right - stepsRect.left;
      const left = Math.max(0, labelRight + gap);
      const maxWidth = Math.max(0, tabRight - left);

      steps.style.setProperty('--lc-art-left', `${left}px`);
      steps.style.setProperty('--lc-art-fit-width', `${Math.min(artSize, maxWidth)}px`);
    };

    updateArtPlacement();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateArtPlacement);
    observer.observe(steps);
    observer.observe(tab);
    return () => observer.disconnect();
  }, [activeCategoryArt, selectedCategoryId, tutorialId, state.status]);

  const tutorialHeaderTitle = useMemo(() => (
    tutorialId ? (
      <div className="learning-center-tutorial-header__title">
        {t('tutorialPanelTitle')}
      </div>
    ) : null
  ), [t, tutorialId]);

  const tutorialHeaderActions = useMemo(() => (
    tutorialId ? (
      <button
        type="button"
        className={contentHeaderActionBtnClass}
        aria-label={t('close')}
        onClick={closeTutorial}
      >
        <PanelRightClose className="h-4 w-4" strokeWidth={1.75} aria-hidden />
      </button>
    ) : null
  ), [closeTutorial, t, tutorialId]);

  useContentHeader({
    title: null,
    previewTabs: tutorialHeaderTitle,
    previewActions: tutorialHeaderActions,
    layoutMode: tutorialId ? 'split' : 'conversation',
  });

  return (
    <>
      <div className={`learning-center-split h-full min-h-0${tutorialId ? ' learning-center-split--open' : ''}`}>
      <main
        ref={pageRootRef}
        className={`learning-center-page h-full min-h-0 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6 lg:px-8${tutorialId ? ' learning-center-page--detail-open' : ''}`}
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
                <h1 className="learning-center-hero__title">{renderDomainTitle(domainTitle, titleStepCount, t('titleStepSuffix'), t('titleStepLabel'))}</h1>
                <p className="learning-center-hero__subtitle">{state.domain.subTitle || state.domain.description || t('fallbackSubtitle')}</p>
              </section>

              {state.categories.length === 0 ? (
                <FeedbackState state="empty" title={t('emptyCategoryTitle')} description={t('emptyCategoryDescription')} />
              ) : (
                <section
                  ref={stepsRef}
                  className="learning-center-steps"
                  aria-label={t('categoriesTitle')}
                  style={{
                    '--lc-steps-height': `${tutorialSectionHeight}px`,
                    '--lc-panel-height': `${tutorialPanelHeight}px`,
                  } as CSSProperties}
                >
                  <Tabs
                    value={state.selectedCategoryId ?? undefined}
                    onValueChange={selectCategory}
                    className="learning-center-steps__tabs-root"
                  >
                    <div className="learning-center-steps__scroller">
                      <TabsList
                        aria-label={t('categoriesAria')}
                        className="learning-center-steps__tabs h-auto min-h-[3.25rem] rounded-none border-0 p-0 shadow-none"
                      >
                        {state.categories.map((category, index) => (
                          <TabsTrigger
                            key={category.id}
                            ref={category.id === selectedCategoryId ? activeTabRef : undefined}
                            value={category.id}
                            aria-label={category.title || category.name}
                            className="learning-center-steps__tab rounded-none shadow-none"
                            style={index === state.categories.length - 1
                              ? ({ '--lc-tab-title-max': '8em' } as CSSProperties)
                              : undefined}
                          >
                            <span className="learning-center-steps__tab-label">
                              {index < state.categories.length - 1 ? (
                                <span className="learning-center-steps__index" aria-hidden>{categoryIndexLabel(index)}</span>
                              ) : null}
                              <span className="learning-center-steps__title truncate">{category.title || category.name}</span>
                            </span>
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                  </Tabs>
                  {activeCategoryArt ? (
                    <span
                      aria-hidden
                      className="learning-center-steps__art"
                      style={{
                        '--lc-art-rotate': `${activeCategoryArt.rotate}deg`,
                        '--lc-art-x': `${(activeCategoryArt.cardX / 140) * 100}%`,
                        '--lc-art-y': `${(activeCategoryArt.cardY / 140) * 100}%`,
                      } as CSSProperties}
                    >
                      {activeCategoryArt.composed ? (
                        <img
                          src={activeCategoryArt.source}
                          alt=""
                          className="learning-center-steps__art-composed"
                        />
                      ) : (
                        <span className="learning-center-steps__art-card">
                          <span className="learning-center-steps__art-inner">
                            <img src={activeCategoryArt.source} alt="" />
                          </span>
                        </span>
                      )}
                    </span>
                  ) : null}

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
                      {tutorials.status === 'ready' && tutorials.items.length === 0 && (
                        <div className="learning-center-empty learning-center-steps__empty" role="status">
                          <img src={sectionEmptyIcon} alt="" aria-hidden className="learning-center-empty__icon" width={48} height={48} />
                          <p className="learning-center-empty__text">{t('tutorialsEmptyTitle')}</p>
                        </div>
                      )}
                      {tutorials.status === 'ready' && tutorials.items.length > 0 && (
                        <ul className="learning-center-tutorial-list" aria-label={t('tutorialsTitle')}>
                          {tutorials.items.slice(0, CONTENT_PAGE_SIZE).map((tutorial, index) => (
                            <li key={tutorial.id} className="learning-center-tutorial-item">
                              <span className="learning-center-tutorial-index" aria-hidden>{index + 1}</span>
                              <div className="learning-center-tutorial-copy">
                                <p className="truncate text-xs font-semibold leading-4" title={tutorial.title || tutorial.name}>{tutorial.title || tutorial.name}</p>
                                {(tutorial.subTitle || tutorial.description) && (
                                  <p
                                    className="truncate text-[0.6875rem] leading-4 text-muted-foreground"
                                    title={tutorial.subTitle || tutorial.description}
                                  >
                                    {tutorial.subTitle || tutorial.description}
                                  </p>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="link"
                                className="learning-center-tutorial-link h-auto px-0 py-0 text-primary hover:text-primary"
                                onClick={(event) => {
                                  detailReturnFocusRef.current = event.currentTarget;
                                  setTutorialPanelContainer(tutorialSlotRef.current);
                                  setDetailCase(null);
                                  setPreviewCase(null);
                                  setTutorialId(tutorial.id);
                                }}
                              >
                                {t('viewTutorial')}
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
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
                  {cases.status === 'ready' && cases.items.length === 0 && (
                    <div className="learning-center-empty learning-center-cases__empty" role="status">
                      <img src={sectionEmptyIcon} alt="" aria-hidden className="learning-center-empty__icon" width={48} height={48} />
                      <p className="learning-center-empty__text">{t('casesEmptyTitle')}</p>
                    </div>
                  )}
                  {cases.status === 'ready' && cases.items.length > 0 && (
                    <>
                      <ul className="learning-center-cases__grid" aria-label={t('casesTitle')}>
                        {cases.items.map((item) => (
                          <li key={item.id} className="learning-center-cases__item">
                            <LearningCaseCard
                              item={item}
                              onViewDetail={(target, trigger) => {
                                caseReturnFocusRef.current = trigger;
                                setTutorialId(null);
                                setPreviewCase(null);
                                setDetailCase(target);
                              }}
                              onPreviewCover={(target, trigger) => {
                                caseReturnFocusRef.current = trigger;
                                setTutorialId(null);
                                setDetailCase(null);
                                setPreviewCase(target);
                              }}
                              onUse={(target, trigger) => {
                                caseReturnFocusRef.current = trigger;
                                setTutorialId(null);
                                setDetailCase(null);
                                setPreviewCase(null);
                                void confirmCaseUse(target);
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
      <div
        ref={tutorialSlotRef}
        className="learning-center-split__aside"
        aria-hidden={!tutorialId}
      />
      </div>
      <TutorialPanel
        key={tutorialId ?? 'closed'}
        tutorialId={tutorialId}
        portalContainer={tutorialPanelContainer}
        returnFocusRef={detailReturnFocusRef}
        onClose={closeTutorial}
      />
      <CaseCoverPreviewDialog
        key={previewCase?.id ?? 'case-cover-closed'}
        open={Boolean(previewCase)}
        title={previewCase ? (previewCase.title || previewCase.name) : ''}
        imageUrl={previewCase?.coverImageUrl || ''}
        returnFocusRef={caseReturnFocusRef}
        onClose={() => setPreviewCase(null)}
      />
      <CaseDetailDialog
        key={detailCase?.id ?? 'case-detail-closed'}
        caseId={detailCase?.id ?? null}
        fallbackTitle={detailCase ? (detailCase.title || detailCase.name) : ''}
        returnFocusRef={caseReturnFocusRef}
        onClose={() => setDetailCase(null)}
        onPreviewCover={(trigger) => {
          if (!detailCase) return;
          caseReturnFocusRef.current = trigger;
          setTutorialId(null);
          setPreviewCase(detailCase);
          setDetailCase(null);
        }}
        onUse={(trigger) => {
          if (!detailCase) return;
          caseReturnFocusRef.current = trigger;
          setTutorialId(null);
          setPreviewCase(null);
          const item = detailCase;
          setDetailCase(null);
          void confirmCaseUse(item);
        }}
      />
    </>
  );
}
