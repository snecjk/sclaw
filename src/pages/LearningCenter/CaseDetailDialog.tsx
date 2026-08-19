import { useEffect, useState, type RefObject } from 'react';
import { RefreshCw, X, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeedbackState } from '@/components/common/FeedbackState';
import { WorkflowNodesIcon } from '@/components/icons/composer-toolbar-icons';
import { SkillMessageTag } from '@/components/skill-plaza/SkillMessageTag';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { resolveLearningCaseChipTitle } from '@/lib/learning-case-chip-title';
import { composeLearningCasePromptPreview } from '@/lib/learning-case-prompt-preview';
import { getCaseDetail } from '@/lib/learning-center-api';
import type { LearningCaseDetail, LearningCaseTemplate } from '@/types/learning-center';
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
  onUse: (trigger: HTMLElement) => void;
  onPreviewCover: (trigger: HTMLElement) => void;
}

function sceneText(detail: LearningCaseTemplate): string {
  return detail.sceneDescription || detail.description;
}

export function CaseDetailDialog({
  caseId,
  fallbackTitle,
  returnFocusRef,
  onClose,
  onUse,
  onPreviewCover,
}: CaseDetailDialogProps) {
  const { t } = useTranslation('learningCenter');
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<CaseDetailState>({ status: 'loading' });
  const [chipTitle, setChipTitle] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!caseId) return () => { active = false; };
    setState({ status: 'loading' });
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
  const title = detail ? (detail.title || detail.name || fallbackTitle) : (fallbackTitle || t('caseDetailTitle'));
  const scene = detail ? sceneText(detail) : '';
  const promptPreview = detail
    ? composeLearningCasePromptPreview({
      targetType: detail.targetType,
      chipTitle,
      targetCode: detail.targetCode,
      promptText: detail.promptText,
    })
    : { visible: false as const };

  useEffect(() => {
    if (!detail) {
      setChipTitle(undefined);
      return;
    }
    let active = true;
    void resolveLearningCaseChipTitle(detail).then((resolved) => {
      if (active) setChipTitle(resolved);
    });
    return () => {
      active = false;
    };
  }, [detail]);

  return (
    <Dialog open={Boolean(caseId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="learning-center-case-detail w-[640px] max-w-[min(640px,calc(100vw-2rem))] gap-0 p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <DialogHeader className="learning-center-case-detail__header space-y-0">
          <DialogTitle className="learning-center-case-detail__title">{title}</DialogTitle>
          <DialogDescription className="learning-center-case-detail__hint">
            {t('caseDetailDescription')}
          </DialogDescription>
        </DialogHeader>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="learning-center-case-detail__close h-[18px] w-[18px] p-0"
          aria-label={t('close')}
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>

        <div className="learning-center-case-detail__body" aria-busy={state.status === 'loading'}>
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
            <div className="learning-center-case-detail__content">
              <div className="learning-center-case-detail__scene-block">
                {scene && (
                  <section className="min-w-0">
                    <h3 className="learning-center-case-detail__label">{t('caseDetailSceneTitle')}</h3>
                    <p className="learning-center-case-detail__scene">{scene}</p>
                  </section>
                )}

                <div className="learning-center-case-detail__cover">
                  <LearningCoverImage
                    url={detail.coverImageUrl}
                    alt={t('caseCoverAlt', { title })}
                    className="learning-center-case-detail__image"
                    iconClassName="h-12 w-12"
                  />
                  <button
                    type="button"
                    className="learning-center-case-detail__zoom"
                    aria-label={t('casePreviewCover', { title })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreviewCover(event.currentTarget);
                    }}
                  >
                    <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                  </button>
                </div>
              </div>

              {promptPreview.visible && (
                <section className="learning-center-case-detail__prompt-block min-w-0">
                  <h3 className="learning-center-case-detail__label">{t('caseDetailPromptTitle')}</h3>
                  <div className="learning-center-case-detail__prompt">
                    {promptPreview.kind === 'SKILL' ? (
                      <SkillMessageTag title={promptPreview.title} />
                    ) : null}
                    {promptPreview.kind === 'WORKFLOW' ? (
                      <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-[#EEF3FF] px-1 py-0.5 align-middle text-[12px] font-medium leading-4 text-[#4E6FFF]">
                        <WorkflowNodesIcon className="h-3 w-3 shrink-0 text-current" />
                        <span>{promptPreview.title}</span>
                      </span>
                    ) : null}
                    {(promptPreview.kind === 'CHAT' ? promptPreview.text : promptPreview.suffix) ? (
                      <p className="learning-center-case-detail__prompt-text">
                        {promptPreview.kind === 'CHAT' ? promptPreview.text : promptPreview.suffix}
                      </p>
                    ) : null}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        {detail && (
          <div className="learning-center-case-detail__footer">
            <Button
              type="button"
              variant="outline"
              className="learning-center-case-detail__cancel h-[34px] rounded-xl px-4"
              onClick={onClose}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              className="learning-center-case-detail__use h-[34px] rounded-xl px-4 bg-foreground text-background hover:bg-foreground/90 hover:text-background"
              onClick={(event) => onUse(event.currentTarget)}
            >
              {detail.actionText || t('caseUseAction')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
