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

export interface ArtifactShareDialogProps {
  open: boolean;
  draft: DingTalkShareDialogDraft | null;
  onConfirm: (draft: DingTalkShareDialogDraft) => void | Promise<void>;
  onCancel: () => void;
  onError?: (error: unknown) => void;
}

export function ArtifactShareDialog({
  open,
  draft,
  onConfirm,
  onCancel,
  onError,
}: ArtifactShareDialogProps) {
  const { t } = useTranslation('chat');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open || !draft) return;
    setConfirming(false);
  }, [open, draft]);

  useEffect(() => {
    if (open && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [open]);

  if (!open || !draft) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !confirming) {
      e.preventDefault();
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (confirming) return;
    const result = onConfirm(draft);
    if (result instanceof Promise) {
      setConfirming(true);
      result.catch((error) => onError?.(error)).finally(() => setConfirming(false));
    }
  };

  const isArtifact = draft.kind === 'artifact';
  const title = isArtifact
    ? t('preview.shareDialog.artifactTitle')
    : t('preview.shareDialog.conversationTitle');
  const description = isArtifact
    ? t('preview.shareDialog.artifactDescription')
    : t('preview.shareDialog.conversationDescription');

  const artifactCard = isArtifact
    ? draft
    : draft.artifact;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.42)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-share-dialog-title"
      onKeyDown={handleKeyDown}
    >
      <div
        className={cn(
          'mx-4 w-full max-w-[480px] rounded-2xl border border-glass-border glass-panel p-6',
          'shadow-2xl focus:outline-none',
        )}
        tabIndex={-1}
      >
        <h2 id="artifact-share-dialog-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>

        <div className="mt-4 space-y-3">
          {!isArtifact && draft.textPreview ? (
            <p className="whitespace-pre-line text-sm leading-6 text-foreground">
              {draft.textPreview}
            </p>
          ) : null}

          {artifactCard ? (
            <ArtifactProductCard
              title={artifactCard.title}
              metaLine={artifactCard.metaLine}
              onAction={() => {}}
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
            onClick={handleConfirm}
            disabled={confirming || (!isArtifact && !draft.textPreview && !draft.artifact)}
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
