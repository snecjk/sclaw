/**
 * DingTalkShareDialog — confirm artifact or conversation content before sharing to DingTalk.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ArtifactProductCard } from '@/components/chat/artifact-product-card';
import type { DingTalkShareDialogDraft } from '@/lib/dingtalk-share';
import {
  openDingTalkShareAfterClipboardCopy,
  prepareDingTalkShareFromDraft,
  shareToDingTalk,
} from '@/lib/dingtalk-share';

type DialogStep = 'preview' | 'too_long';

const SHARE_DIALOG_PANEL_CLASS =
  'mx-4 w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-2xl focus:outline-none';
const SHARE_DIALOG_CONTENT_CLASS =
  'box-border flex w-full flex-col gap-3 self-stretch rounded-xl border border-[#E8EAEF] bg-[#FAFBFC] px-4 py-3';

type TooLongPayload = {
  defaultMsg: string;
  title: string;
};

export interface ArtifactShareDialogProps {
  open: boolean;
  draft: DingTalkShareDialogDraft | null;
  onShared: () => void;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

export function ArtifactShareDialog({
  open,
  draft,
  onShared,
  onCancel,
  onError,
}: ArtifactShareDialogProps) {
  const { t } = useTranslation('chat');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<DialogStep>('preview');
  const [tooLongPayload, setTooLongPayload] = useState<TooLongPayload | null>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setConfirming(false);
    setStep('preview');
    setTooLongPayload(null);
  }, [open, draft]);

  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open, step]);

  if (!open || !draft) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !confirming) {
      e.preventDefault();
      onCancel();
    }
  };

  const handlePreviewConfirm = async () => {
    if (confirming) return;
    setConfirming(true);
    try {
      const prepared = await prepareDingTalkShareFromDraft(draft);
      if (prepared.status === 'too_long') {
        setTooLongPayload({
          defaultMsg: prepared.defaultMsg,
          title: prepared.title,
        });
        setStep('too_long');
        return;
      }
      await shareToDingTalk(prepared.content);
      onShared();
    } catch (error) {
      onError?.(error);
    } finally {
      setConfirming(false);
    }
  };

  const handleTooLongConfirm = async () => {
    if (confirming || !tooLongPayload) return;
    setConfirming(true);
    try {
      await openDingTalkShareAfterClipboardCopy(
        tooLongPayload.title,
        tooLongPayload.defaultMsg,
        t('preview.shareDialog.tooLongPickerHint'),
      );
      onShared();
    } catch (error) {
      onError?.(error);
    } finally {
      setConfirming(false);
    }
  };

  if (step === 'too_long') {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-share-too-long-title"
        onKeyDown={handleKeyDown}
      >
        <div
          className={cn(SHARE_DIALOG_PANEL_CLASS)}
          tabIndex={-1}
        >
          <h2 id="artifact-share-too-long-title" className="text-lg font-semibold">
            {t('preview.shareDialog.tooLongTitle')}
          </h2>
          <p className="mt-3 text-sm leading-6 text-foreground">
            {t('preview.shareDialog.tooLongDescription')}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              ref={cancelRef}
              variant="outline"
              onClick={onCancel}
              disabled={confirming}
              className="rounded-full px-5"
            >
              {t('preview.shareDialog.cancel')}
            </Button>
            <Button
              onClick={handleTooLongConfirm}
              disabled={confirming}
              className="rounded-full px-5"
            >
              {confirming ? t('preview.shareDialog.uploading') : t('preview.shareDialog.tooLongConfirm')}
            </Button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  const isArtifact = draft.kind === 'artifact';
  const title = isArtifact
    ? t('preview.shareDialog.artifactTitle')
    : t('preview.shareDialog.conversationTitle');
  const description = isArtifact
    ? t('preview.shareDialog.artifactDescription')
    : t('preview.shareDialog.conversationDescription');

  const artifactCard = isArtifact ? draft : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-share-dialog-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className={SHARE_DIALOG_PANEL_CLASS}
        tabIndex={-1}
      >
        <h2 id="artifact-share-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>

        <div className="mt-4">
          {!isArtifact && draft.textPreview ? (
            <div className={SHARE_DIALOG_CONTENT_CLASS}>
              <p className="line-clamp-9 whitespace-pre-line text-sm leading-6 text-foreground">
                {draft.textPreview}
              </p>
            </div>
          ) : null}

          {artifactCard ? (
            <ArtifactProductCard
              title={artifactCard.title}
              metaLine={artifactCard.metaLine}
              onAction={() => {}}
              showActionLabel={false}
              className="pointer-events-none"
            />
          ) : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-full px-5"
          >
            {t('preview.shareDialog.cancel')}
          </Button>
          <Button
            onClick={handlePreviewConfirm}
            disabled={confirming || (!isArtifact && !draft.textPreview)}
            className="rounded-full px-5"
          >
            {confirming ? t('preview.shareDialog.uploading') : t('preview.shareDialog.confirm')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
