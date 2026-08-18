import { useEffect, useState, type RefObject } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getCaseDetail } from '@/lib/learning-center-api';
import type { LearningCaseDetail, LearningTutorial } from '@/types/learning-center';
import { LearningCoverImage } from './LearningCoverImage';

type CaseDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: LearningCaseDetail }
  | { status: 'error'; message: string };

interface CaseDetailDialogProps {
  caseId: string | null;
  fallbackTitle: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

function resolveTutorials(detail: LearningCaseDetail): LearningTutorial[] {
  if (detail.tutorials.length > 0) return detail.tutorials;
  return detail.tutorial ? [detail.tutorial] : [];
}

export function CaseDetailDialog({ caseId, fallbackTitle, returnFocusRef, onClose }: CaseDetailDialogProps) {
  const { t } = useTranslation('learningCenter');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<CaseDetailState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    if (!caseId) return () => { active = false; };
    getCaseDetail(caseId).then((detail) => {
      if (active) setState({ status: 'ready', detail });
    }).catch((error: unknown) => {
      if (!active) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : t('caseDetailErrorDescription'),
      });
    });
    return () => { active = false; };
  }, [caseId, reloadKey, t]);

  const detail = state.status === 'ready' ? state.detail : null;
  const tutorials = detail ? resolveTutorials(detail) : [];

  return (
    <Dialog open={Boolean(caseId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-2xl gap-0 p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-14">
          <DialogTitle className="truncate">
            {detail ? (detail.title || detail.name || fallbackTitle) : (fallbackTitle || t('caseDetailTitle'))}
          </DialogTitle>
          <DialogDescription>
            {detail?.subTitle || t('caseDetailDescription')}
          </DialogDescription>
        </DialogHeader>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" aria-busy={state.status === 'loading'}>
          {state.status === 'loading' && (
            <FeedbackState state="loading" title={t('caseDetailLoading')} description={t('caseDetailLoadingDescription')} />
          )}

          {state.status === 'error' && (
            <div role="alert">
              <FeedbackState
                state="error"
                title={t('caseDetailErrorTitle')}
                description={state.message || t('caseDetailErrorDescription')}
                action={(
                  <Button type="button" size="sm" onClick={() => {
                    setState({ status: 'loading' });
                    setReloadKey((value) => value + 1);
                  }}>
                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                    {t('retry')}
                  </Button>
                )}
              />
            </div>
          )}

          {detail && (
            <div className="flex min-w-0 flex-col gap-5">
              {detail.coverImageUrl && (
                <LearningCoverImage
                  url={detail.coverImageUrl}
                  alt={t('caseCoverAlt', { title: detail.title || detail.name })}
                  className="aspect-[16/9] w-full rounded-xl object-cover"
                />
              )}

              {(detail.sceneTitle || detail.sceneDescription) && (
                <section className="min-w-0">
                  <h3 className="text-sm font-semibold">{detail.sceneTitle || t('caseDetailSceneTitle')}</h3>
                  {detail.sceneDescription && (
                    <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{detail.sceneDescription}</p>
                  )}
                </section>
              )}

              {detail.description && (
                <section className="min-w-0">
                  <h3 className="text-sm font-semibold">{t('caseDetailDescriptionTitle')}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm leading-6 text-muted-foreground">{detail.description}</p>
                </section>
              )}

              <section className="min-w-0">
                <h3 className="text-sm font-semibold">{t('caseDetailTutorialTitle')}</h3>
                {tutorials.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">{t('caseDetailTutorialEmpty')}</p>
                ) : (
                  <div className="mt-2 flex min-w-0 flex-col gap-4">
                    {tutorials.map((tutorial) => (
                      <article key={tutorial.id} className="min-w-0">
                        <p className="text-sm font-medium">{tutorial.title || tutorial.name}</p>
                        {(tutorial.subTitle || tutorial.description) && (
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{tutorial.subTitle || tutorial.description}</p>
                        )}
                        {tutorial.content && (
                          <TutorialViewer html={tutorial.content} imageErrorLabel={t('imageLoadError')} />
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
