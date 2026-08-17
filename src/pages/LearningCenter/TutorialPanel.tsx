import { useEffect, useState, type RefObject } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getTutorialDetail, LearningCenterApiError } from '@/lib/learning-center-api';
import type { LearningTutorial } from '@/types/learning-center';

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; tutorial: LearningTutorial }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

interface TutorialPanelProps {
  tutorialId: string | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function TutorialPanel({ tutorialId, returnFocusRef, onClose }: TutorialPanelProps) {
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
        className="flex w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[564px]"
        overlayClassName="lg:hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-14 text-left">
          <SheetTitle>{state.status === 'ready' ? state.tutorial.title : t('tutorialPanelTitle')}</SheetTitle>
          <SheetDescription>
            {state.status === 'ready'
              ? state.tutorial.subTitle || state.tutorial.description || t('tutorialPanelDescription')
              : t('tutorialPanelDescription')}
          </SheetDescription>
        </SheetHeader>
        <Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3" aria-label={t('close')} onClick={onClose}>
          <X className="h-4 w-4" aria-hidden />
        </Button>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
            <TutorialViewer html={state.tutorial.content ?? ''} imageErrorLabel={t('imageLoadError')} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
