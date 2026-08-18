import { useEffect, useState, type RefObject } from 'react';
import { PanelRightClose, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTutorialDetail, LearningCenterApiError } from '@/lib/learning-center-api';
import type { LearningTutorial } from '@/types/learning-center';
import './TutorialPanel.css';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; tutorial: LearningTutorial }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

interface TutorialPanelProps {
  tutorialId: string | null;
  portalContainer: HTMLElement | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function TutorialPanel({ tutorialId, portalContainer, returnFocusRef, onClose }: TutorialPanelProps) {
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
        className="learning-center-tutorial-sheet flex flex-col gap-0 overflow-hidden p-0 motion-reduce:animate-none motion-reduce:transition-none"
        portalContainer={portalContainer}
        overlayClassName="learning-center-tutorial-sheet__overlay lg:hidden motion-reduce:animate-none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: '35.25rem',
          minWidth: '35.25rem',
          maxWidth: '35.25rem',
          height: 'auto',
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <SheetHeader className="learning-center-tutorial-sheet__header shrink-0 text-left">
          <SheetTitle className="learning-center-tutorial-sheet__title">{t('tutorialPanelTitle')}</SheetTitle>
          <SheetDescription className="sr-only">
            {state.status === 'ready'
              ? state.tutorial.subTitle || state.tutorial.description || t('tutorialPanelDescription')
              : t('tutorialPanelDescription')}
          </SheetDescription>
        </SheetHeader>
        <Button type="button" variant="ghost" size="icon" className="learning-center-tutorial-sheet__close absolute" aria-label={t('close')} onClick={onClose}>
          <PanelRightClose className="h-4 w-4" aria-hidden />
        </Button>
        <div className="learning-center-tutorial-sheet__body min-h-0 flex-1">
          <section className="learning-center-tutorial-sheet__content">
            {state.status === 'ready' && (
              <h2 className="learning-center-tutorial-sheet__content-title">{state.tutorial.title}</h2>
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
