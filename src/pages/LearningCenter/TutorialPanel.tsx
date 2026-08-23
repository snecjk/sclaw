import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTutorialDetail, LearningCenterApiError } from '@/lib/learning-center-api';
import type { LearningTutorial } from '@/types/learning-center';
import { cn } from '@/lib/utils';
import './TutorialPanel.css';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; tutorial: LearningTutorial }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

interface TutorialPanelProps {
  tutorialId: string | null;
  portalContainer: HTMLElement | null;
  expanded?: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  resizeHandle?: ReactNode;
  onClose: () => void;
}

export function TutorialPanel({ tutorialId, portalContainer, expanded = false, returnFocusRef, resizeHandle, onClose }: TutorialPanelProps) {
  const { t } = useTranslation('learningCenter');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!tutorialId) return () => { active = false; };
    getTutorialDetail(tutorialId).then((tutorial) => {
      if (active) setState({ status: 'ready', tutorial });
    }).catch((error: unknown) => {
      if (!active) return;
      const forbidden = error instanceof LearningCenterApiError && error.code === '403';
      setState({
        status: forbidden ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : t('tutorialDetailErrorDescription'),
      });
    });
    return () => { active = false; };
  }, [reloadKey, t, tutorialId]);

  const retry = (
    <Button type="button" size="sm" onClick={() => {
      setState({ status: 'loading' });
      setReloadKey((value) => value + 1);
    }}>
      <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
      {t('retry')}
    </Button>
  );

  return (
    <Sheet modal={false} open={Boolean(tutorialId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className={cn(
          'learning-center-tutorial-sheet flex flex-col gap-0 overflow-hidden p-0 !absolute inset-0',
          expanded && 'learning-center-tutorial-sheet--expanded',
        )}
        portalContainer={portalContainer}
        showOverlay={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        {resizeHandle}
        <SheetHeader className="sr-only">
          <SheetTitle>{t('tutorialPanelTitle')}</SheetTitle>
          <SheetDescription className="sr-only">
            {state.status === 'ready'
              ? state.tutorial.subTitle || state.tutorial.description || t('tutorialPanelDescription')
              : t('tutorialPanelDescription')}
          </SheetDescription>
        </SheetHeader>
        <div className="learning-center-tutorial-sheet__body min-h-0 flex-1">
          <section className="learning-center-tutorial-sheet__content">
            {state.status === 'ready' && (
              <div className="learning-center-tutorial-sheet__content-header">
                <h2 className="learning-center-tutorial-sheet__content-title">{state.tutorial.title}</h2>
                <button
                  type="button"
                  className="learning-center-tutorial-sheet__close"
                  aria-label={t('close')}
                  onClick={onClose}
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
            <div className="learning-center-tutorial-sheet__content-scroll">
              {state.status === 'loading' && (
                <FeedbackState state="loading" title={t('tutorialDetailLoading')} description={t('tutorialDetailLoadingDescription')} />
              )}
              {state.status === 'forbidden' && (
                <div role="alert">
                  <FeedbackState state="error" title={t('tutorialForbiddenTitle')} description={state.message || t('tutorialForbiddenDescription')} />
                </div>
              )}
              {state.status === 'error' && (
                <div role="alert">
                  <FeedbackState state="error" title={t('tutorialDetailErrorTitle')} description={state.message} action={retry} />
                </div>
              )}
              {state.status === 'ready' && (
                <TutorialViewer className="tutorial-panel-viewer" html={state.tutorial.content ?? ''} imageErrorLabel={t('imageLoadError')} />
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
